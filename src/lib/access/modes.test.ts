import { describe, expect, it } from 'vitest';
import { accessMode, evaluateAccess, GRACE_DAYS, graceDaysLeft, trialDaysLeft } from './modes';

const NOW = new Date('2026-10-01T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const base = { isSuspended: false, subscriptionStatus: 'active', pastDueSince: null as string | null };

describe('accessMode', () => {
    it('active and trialing are full', () => {
        expect(accessMode(base, NOW)).toBe('full');
        expect(accessMode({ ...base, subscriptionStatus: 'trialing' }, NOW)).toBe('full');
    });

    it('suspended is blocked regardless of billing', () => {
        expect(accessMode({ ...base, isSuspended: true, subscriptionStatus: 'canceled' }, NOW)).toBe('blocked');
    });

    it(`past due: grace through day ${GRACE_DAYS}, read-only after`, () => {
        const pd = (d: number) => accessMode({ ...base, subscriptionStatus: 'past_due', pastDueSince: daysAgo(d) }, NOW);
        expect(pd(0)).toBe('grace');
        expect(pd(GRACE_DAYS)).toBe('grace');
        expect(pd(GRACE_DAYS + 0.01)).toBe('readonly');
        expect(pd(30)).toBe('readonly');
    });

    it('past due without a start date stays in grace', () => {
        expect(accessMode({ ...base, subscriptionStatus: 'past_due' }, NOW)).toBe('grace');
    });

    it('canceled is read-only', () => {
        expect(accessMode({ ...base, subscriptionStatus: 'canceled' }, NOW)).toBe('readonly');
    });
});

describe('day counters', () => {
    it('grace days left counts down to 0', () => {
        expect(graceDaysLeft({ ...base, subscriptionStatus: 'past_due', pastDueSince: daysAgo(2) }, NOW)).toBe(GRACE_DAYS - 2);
        expect(graceDaysLeft({ ...base, subscriptionStatus: 'past_due', pastDueSince: daysAgo(GRACE_DAYS) }, NOW)).toBe(0);
        expect(graceDaysLeft(base, NOW)).toBeNull();
    });

    it('trial days left only while trialing', () => {
        const end = new Date(NOW.getTime() + 8.5 * 86_400_000).toISOString();
        expect(trialDaysLeft({ subscriptionStatus: 'trialing', currentPeriodEnd: end }, NOW)).toBe(9);
        expect(trialDaysLeft({ subscriptionStatus: 'active', currentPeriodEnd: end }, NOW)).toBeNull();
    });
});

describe('evaluateAccess', () => {
    const run = (over: Partial<Parameters<typeof evaluateAccess>[0]>) =>
        evaluateAccess({ mode: 'full', features: { invoices: true }, grants: {}, role: 'admin', permission: 'invoices.create', ...over });

    it('checks in order: blocked, plan, role, read-only', () => {
        expect(run({ mode: 'blocked', features: {} })).toBe('AGENCY_SUSPENDED');
        expect(run({ features: {}, role: 'creator' })).toBe('FEATURE_NOT_IN_PLAN');
        expect(run({ role: 'creator', mode: 'readonly' })).toBe('FORBIDDEN');
        expect(run({ mode: 'readonly' })).toBe('READ_ONLY');
        expect(run({ mode: 'readonly', permission: 'invoices.view' })).toBeNull();
        expect(run({ mode: 'grace' })).toBeNull();
    });
});
