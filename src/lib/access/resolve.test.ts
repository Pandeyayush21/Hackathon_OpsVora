import { describe, expect, it } from 'vitest';
import { isWithinLimit, parseEntitlements, resolveDetailed, resolveEntitlements, type ResolveInput } from './resolve';

const base: ResolveInput = {
    features: [
        { key: 'invoices', status: 'available', is_core: false },
        { key: 'clients', status: 'available', is_core: true },
        { key: 'leaves', status: 'beta', is_core: false },
        { key: 'hr', status: 'coming_soon', is_core: false },
        { key: 'legacy', status: 'deprecated', is_core: true },
    ],
    planFeatures: [
        { feature_key: 'invoices', enabled: false },
        { feature_key: 'leaves', enabled: true },
        { feature_key: 'hr', enabled: true },
    ],
    featureOverrides: [],
    limitDefs: [
        { key: 'clients', default_value: 3 },
        { key: 'storageMB', default_value: 500 },
    ],
    planLimits: [{ limit_key: 'clients', value: 10 }],
    limitOverrides: [],
    now: new Date('2026-01-01T00:00:00Z'),
};

describe('resolveDetailed — features', () => {
    it('uses the plan row when present', () => {
        const r = resolveDetailed(base);
        expect(r.features.invoices).toEqual({ enabled: false, source: 'plan' });
        expect(r.features.leaves).toEqual({ enabled: true, source: 'plan' });
    });

    it('falls back to is_core when the plan has no row', () => {
        expect(resolveDetailed(base).features.clients).toEqual({ enabled: true, source: 'default' });
    });

    it('coming_soon and deprecated are off regardless of plan, core or override', () => {
        const r = resolveDetailed({
            ...base,
            featureOverrides: [{ feature_key: 'hr', enabled: true, expires_at: null }],
        });
        expect(r.features.hr).toEqual({ enabled: false, source: 'status' });
        expect(r.features.legacy).toEqual({ enabled: false, source: 'status' });
    });

    it('an active override beats the plan', () => {
        const r = resolveDetailed({
            ...base,
            featureOverrides: [
                { feature_key: 'invoices', enabled: true, expires_at: null },
                { feature_key: 'clients', enabled: false, expires_at: '2027-01-01T00:00:00Z' },
            ],
        });
        expect(r.features.invoices).toEqual({ enabled: true, source: 'override' });
        expect(r.features.clients).toEqual({ enabled: false, source: 'override' });
    });

    it('ignores expired overrides', () => {
        const r = resolveDetailed({
            ...base,
            featureOverrides: [{ feature_key: 'invoices', enabled: true, expires_at: '2025-12-31T23:59:59Z' }],
        });
        expect(r.features.invoices).toEqual({ enabled: false, source: 'plan' });
    });
});

describe('resolveDetailed — limits', () => {
    it('override → plan → default', () => {
        expect(resolveDetailed(base).limits).toEqual({
            clients: { value: 10, source: 'plan' },
            storageMB: { value: 500, source: 'default' },
        });

        const r = resolveDetailed({
            ...base,
            limitOverrides: [
                { limit_key: 'clients', value: -1, expires_at: null },
                { limit_key: 'storageMB', value: 9999, expires_at: '2020-01-01T00:00:00Z' },
            ],
        });
        expect(r.limits.clients).toEqual({ value: -1, source: 'override' });
        expect(r.limits.storageMB).toEqual({ value: 500, source: 'default' });
    });
});

describe('resolveEntitlements', () => {
    it('flattens to booleans and numbers', () => {
        expect(resolveEntitlements(base)).toEqual({
            features: { invoices: false, clients: true, leaves: true, hr: false, legacy: false },
            limits: { clients: 10, storageMB: 500 },
        });
    });
});

describe('isWithinLimit', () => {
    it('treats -1 as unlimited', () => {
        expect(isWithinLimit(-1, 1_000_000)).toBe(true);
    });
    it('checks used + adding against the limit', () => {
        expect(isWithinLimit(3, 2)).toBe(true);
        expect(isWithinLimit(3, 3)).toBe(false);
        expect(isWithinLimit(3, 1, 3)).toBe(false);
        expect(isWithinLimit(0, 0)).toBe(false);
    });
});

describe('parseEntitlements', () => {
    it('maps RPC json and rejects null', () => {
        expect(parseEntitlements(null)).toBeNull();
        expect(
            parseEntitlements({
                agency_id: 'a1',
                plan: { id: 'p1', key: 'pro', name: 'Pro' },
                is_suspended: true,
                subscription_status: 'past_due',
                current_period_end: null,
                past_due_since: '2026-09-01T00:00:00Z',
                features: { invoices: true },
                limits: { clients: 50 },
            })
        ).toEqual({
            agencyId: 'a1',
            plan: { id: 'p1', key: 'pro', name: 'Pro' },
            isSuspended: true,
            subscriptionStatus: 'past_due',
            currentPeriodEnd: null,
            pastDueSince: '2026-09-01T00:00:00Z',
            features: { invoices: true },
            limits: { clients: 50 },
        });
    });
});
