import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAN_MATRIX, FEATURES, type FeatureKey } from './catalog';
import { permissionsForRole } from '@/lib/access/roles-core';
import { PORTAL_NAV, clientNav, navState } from './portal-nav';

const ROLES = ['admin', 'manager', 'creator', 'client'] as const;

function featuresFor(plan: keyof typeof DEFAULT_PLAN_MATRIX) {
    const on = new Set<string>(DEFAULT_PLAN_MATRIX[plan].features);
    return Object.fromEntries(FEATURES.map((f) => [f.key, on.has(f.key)])) as Record<FeatureKey, boolean>;
}

function state(role: (typeof ROLES)[number], plan: keyof typeof DEFAULT_PLAN_MATRIX, feature: FeatureKey) {
    const item = PORTAL_NAV.find((nav) => nav.feature === feature)!;
    const permissions = permissionsForRole({}, role);
    return navState(item, { role, features: featuresFor(plan), permissions });
}

describe('navState', () => {
    it('shows the dashboard to every role on every plan', () => {
        for (const role of ROLES) for (const plan of ['free', 'pro', 'ultra'] as const) expect(state(role, plan, 'dashboard')).toBe('shown');
    });

    it('shows settings to leads and hides it from everyone else', () => {
        expect(state('admin', 'free', 'settings')).toBe('shown');
        expect(state('manager', 'free', 'settings')).toBe('shown');
        expect(state('creator', 'free', 'settings')).toBe('hidden');
        expect(state('client', 'free', 'settings')).toBe('hidden');
    });

    it('locks plan gaps for an admin and hides them from everyone else', () => {
        expect(state('admin', 'free', 'invoices')).toBe('locked');
        expect(state('manager', 'free', 'invoices')).toBe('hidden');
        expect(state('creator', 'free', 'invoices')).toBe('hidden');
        expect(state('client', 'free', 'leaves')).toBe('hidden');
    });

    it('locks deliverables on the free plan and shows them on Pro', () => {
        expect(state('admin', 'free', 'deliverables')).toBe('locked');
        expect(state('manager', 'free', 'deliverables')).toBe('hidden');
        expect(state('creator', 'free', 'deliverables')).toBe('hidden');
        expect(state('admin', 'pro', 'deliverables')).toBe('shown');
    });

    it('shows invoices once the plan includes them', () => {
        expect(state('admin', 'pro', 'invoices')).toBe('shown');
        expect(state('client', 'pro', 'invoices')).toBe('shown');
        expect(state('creator', 'ultra', 'invoices')).toBe('hidden');
    });

    it('only returns the three states', () => {
        for (const role of ROLES) {
            for (const plan of ['free', 'pro', 'ultra'] as const) {
                for (const item of PORTAL_NAV) {
                    expect(['hidden', 'locked', 'soon', 'shown']).toContain(state(role, plan, item.feature));
                }
            }
        }
    });
});

describe('clientNav', () => {
    it('always includes home and only plan sections the client can open', () => {
        const permissions = permissionsForRole({}, 'client');
        const free = clientNav('acme', { features: featuresFor('free'), permissions });
        expect(free.map((item) => item.key)).toEqual(['home', 'projects', 'documents']);
        expect(free.find((item) => item.key === 'projects')?.built).toBe(true);
        expect(free.find((item) => item.key === 'documents')?.built).toBe(true);
        const pro = clientNav('acme', { features: featuresFor('pro'), permissions });
        expect(pro.map((item) => item.key)).toContain('invoices');
    });
});
