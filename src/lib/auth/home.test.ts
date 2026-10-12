import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: () => ({}) }));
const { pickDestination, safeNext, sortMemberships } = await import('./home');

describe('sortMemberships', () => {
    it('puts the last-used workspace first, then newest joined', () => {
        const rows = [
            { id: 'old', last_used_at: null, created_at: '2026-01-01' },
            { id: 'used', last_used_at: '2026-09-01', created_at: '2025-01-01' },
            { id: 'new', last_used_at: null, created_at: '2026-06-01' },
            { id: 'recent', last_used_at: '2026-09-20', created_at: '2025-01-01' },
        ];
        expect(sortMemberships(rows).map((r) => r.id)).toEqual(['recent', 'used', 'new', 'old']);
    });
});

const admin = { kind: 'platform' as const, href: '/super-admin', label: 'OpsVora admin' };
const agency = { kind: 'agency' as const, href: '/agency/skillvalley', label: 'Skillvalley' };
const client = { kind: 'client' as const, href: '/portal/skillvalley', label: 'Skillvalley' };

describe('safeNext', () => {
    it('allows same-site relative paths', () => {
        expect(safeNext('/agency/skillvalley')).toBe('/agency/skillvalley');
        expect(safeNext('/super-admin/plans')).toBe('/super-admin/plans');
    });
    it('rejects open redirects and loops', () => {
        expect(safeNext('https://evil.com')).toBeNull();
        expect(safeNext('//evil.com')).toBeNull();
        expect(safeNext('/\\evil.com')).toBeNull();
        expect(safeNext('/login')).toBeNull();
        expect(safeNext('/api/auth/logout')).toBeNull();
        expect(safeNext(undefined)).toBeNull();
    });
});

describe('pickDestination', () => {
    it('sends each role to its home', () => {
        expect(pickDestination([admin], null)).toBe('/super-admin');
        expect(pickDestination([agency], null)).toBe('/agency/skillvalley');
        expect(pickDestination([client], null)).toBe('/portal/skillvalley');
    });
    it('returns null when the account has no workspace', () => {
        expect(pickDestination([], '/agency/x')).toBeNull();
    });
    it('honours the requested page', () => {
        expect(pickDestination([agency], '/agency/skillvalley/clients')).toBe('/agency/skillvalley/clients');
        expect(pickDestination([admin, agency], '/agency/skillvalley')).toBe('/agency/skillvalley');
    });
    it('never sends a non-admin into the admin panel', () => {
        expect(pickDestination([agency], '/super-admin/plans')).toBe('/agency/skillvalley');
        expect(pickDestination([admin], '/super-admin/plans')).toBe('/super-admin/plans');
    });
});
