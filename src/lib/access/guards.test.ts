import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Entitlements } from './resolve';

const state = {
    user: { id: 'u1' } as { id: string } | null,
    member: { user_id: 'u1', agency_id: 'a1', role: 'manager' } as Record<string, unknown> | null,
    entitlements: null as Entitlements | null,
    grants: {} as Record<string, Record<string, boolean>>,
    legacyProfile: null as Record<string, unknown> | null,
};

vi.mock('@/lib/auth', async () => {
    const { NextResponse } = await import('next/server');
    return {
        getAuthUser: async () =>
            state.user ? { user: state.user } : { error: NextResponse.json({ code: 'NO_TOKEN' }, { status: 401 }) },
    };
});

vi.mock('@/lib/supabase/server', () => ({
    createServerSupabaseClient: () => {
        const query = (table: string) => {
            const q = {
                select: () => q,
                eq: () => q,
                maybeSingle: async () => ({ data: table === 'profiles' ? state.legacyProfile : state.member }),
            };
            return q;
        };
        return { from: query };
    },
}));

vi.mock('./entitlements', () => ({ getEntitlements: async () => state.entitlements }));
vi.mock('./roles', async (orig) => ({ ...(await orig<typeof import('./roles')>()), getRoleGrants: async () => state.grants }));

const { requireAccess } = await import('./guards');

const req = () => new NextRequest('http://localhost/api/test');
const ent = (over: Partial<Entitlements> = {}): Entitlements => ({
    agencyId: 'a1',
    plan: { id: 'p', key: 'pro', name: 'Pro' },
    isSuspended: false,
    subscriptionStatus: 'active',
    currentPeriodEnd: null,
    pastDueSince: null,
    features: { invoices: true, team: true },
    limits: {},
    ...over,
});

async function status(r: Awaited<ReturnType<typeof requireAccess>>) {
    return 'error' in r ? { status: r.error.status, code: (await r.error.json()).code } : { status: 200 };
}

describe('requireAccess', () => {
    beforeEach(() => {
        state.user = { id: 'u1' };
        state.member = { user_id: 'u1', agency_id: 'a1', role: 'manager' };
        state.entitlements = ent();
        state.grants = {};
        state.legacyProfile = null;
    });

    it('allows when member, feature in plan, and role granted (catalog default)', async () => {
        expect(await status(await requireAccess(req(), 'a1', 'invoices.create'))).toEqual({ status: 200 });
    });

    it('401 without a session', async () => {
        state.user = null;
        expect((await status(await requireAccess(req(), 'a1', 'invoices.create'))).status).toBe(401);
    });

    it('403 when the membership is disabled, even if the legacy profile still points at the agency', async () => {
        state.member = null;
        state.legacyProfile = { agency_id: 'a1', role: 'admin' };
        expect(await status(await requireAccess(req(), 'a1', 'invoices.create'))).toEqual({ status: 403, code: 'NOT_AGENCY_MEMBER' });
    });

    it('403 NOT_AGENCY_MEMBER for another agency', async () => {
        state.member = null;
        expect(await status(await requireAccess(req(), 'a1', 'invoices.create'))).toEqual({ status: 403, code: 'NOT_AGENCY_MEMBER' });
    });

    it('423 when the agency is suspended', async () => {
        state.entitlements = ent({ isSuspended: true });
        expect(await status(await requireAccess(req(), 'a1', 'invoices.create'))).toEqual({ status: 423, code: 'AGENCY_SUSPENDED' });
    });

    it('402 when the plan lacks the feature', async () => {
        state.entitlements = ent({ features: { invoices: false } });
        expect(await status(await requireAccess(req(), 'a1', 'invoices.create'))).toEqual({ status: 402, code: 'FEATURE_NOT_IN_PLAN' });
    });

    it('403 FORBIDDEN when the role lacks the permission by default', async () => {
        expect(await status(await requireAccess(req(), 'a1', 'team.invite'))).toEqual({ status: 403, code: 'FORBIDDEN' });
    });

    it("ignores a DB grant for a permission outside the role's portal", async () => {
        state.member = { user_id: 'u1', agency_id: 'a1', role: 'client' };
        state.entitlements = ent({ features: { settings: true } });
        state.grants = { client: { 'settings.update': true } };
        expect(await status(await requireAccess(req(), 'a1', 'settings.update'))).toEqual({ status: 403, code: 'FORBIDDEN' });
    });

    it('DB grant overrides the catalog default both ways', async () => {
        state.grants = { manager: { 'invoices.create': false, 'team.invite': true } };
        expect(await status(await requireAccess(req(), 'a1', 'invoices.create'))).toEqual({ status: 403, code: 'FORBIDDEN' });
        expect(await status(await requireAccess(req(), 'a1', 'team.invite'))).toEqual({ status: 200 });
    });

    it('read-only workspace: reads pass, writes get 423 READ_ONLY', async () => {
        state.entitlements = ent({ subscriptionStatus: 'canceled' });
        expect(await status(await requireAccess(req(), 'a1', 'invoices.view'))).toEqual({ status: 200 });
        expect(await status(await requireAccess(req(), 'a1', 'invoices.create'))).toEqual({ status: 423, code: 'READ_ONLY' });
    });

    it('grace period keeps writes working', async () => {
        state.entitlements = ent({ subscriptionStatus: 'past_due', pastDueSince: new Date(Date.now() - 2 * 86_400_000).toISOString() });
        expect(await status(await requireAccess(req(), 'a1', 'invoices.create'))).toEqual({ status: 200 });
    });
});
