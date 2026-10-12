import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: () => ({}) }));
vi.mock('./context', () => ({ getPortalContext: async () => ({}) }));
vi.mock('@/lib/clients/scope', () => ({ clientScope: async () => ({ kind: 'all' }) }));
vi.mock('@/lib/clients/clients', () => ({ isStaffMember: async () => true }));

const { clientCanSee } = await import('./client-context');
const { matchRpcFailure } = await import('@/lib/agreements/rules');

const base = {
    mode: 'full' as const,
    entitlements: { features: { projects: true, agreements: true, comments: true } } as never,
    permissions: ['projects.view', 'comments.view'] as never,
};

describe('client "sign before using the portal" gate', () => {
    it('opens sections normally when nothing is pending', () => {
        expect(clientCanSee({ ...base, clientGate: null }, 'projects', 'projects.view')).toBe(true);
    });

    it('closes every section except agreements while a gated agreement is open', () => {
        const gated = { ...base, clientGate: 'agr-1' };
        expect(clientCanSee(gated, 'projects', 'projects.view')).toBe(false);
        expect(clientCanSee(gated, 'comments', 'comments.view')).toBe(false);
    });
});

describe('offer letter join errors', () => {
    it('explains an already-member join failure instead of a generic one', () => {
        expect(matchRpcFailure('JOIN_FAILED:ALREADY_MEMBER')?.code).toBe('ALREADY_MEMBER');
        expect(matchRpcFailure('JOIN_FAILED:INVITE_REVOKED')?.code).toBe('JOIN_FAILED');
    });
});
