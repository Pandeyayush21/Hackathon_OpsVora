import { describe, expect, it } from 'vitest';
import {
    DEFAULT_PLAN_MATRIX,
    FEATURES,
    LIMITS,
    PERMISSIONS,
    ROLE_KEYS,
    defaultGrant,
    featureOf,
    roleApplies,
} from './catalog';

describe('registry catalog integrity', () => {
    it('feature keys are unique snake_case', () => {
        const keys = FEATURES.map((f) => f.key);
        expect(new Set(keys).size).toBe(keys.length);
        for (const k of keys) expect(k).toMatch(/^[a-z][a-z0-9_]*$/);
    });

    it('permission keys are unique and belong to an existing feature', () => {
        const keys = PERMISSIONS.map((p) => p.key);
        expect(new Set(keys).size).toBe(keys.length);
        const featureKeys = new Set<string>(FEATURES.map((f) => f.key));
        for (const p of PERMISSIONS) {
            expect(featureKeys.has(featureOf(p.key))).toBe(true);
            expect(featureOf(p.key)).toBe(p.featureKey);
        }
    });

    it('every feature declares at least one permission', () => {
        for (const f of FEATURES) {
            expect(PERMISSIONS.some((p) => p.featureKey === f.key), f.key).toBe(true);
        }
    });

    it('default roles are valid role keys', () => {
        for (const p of PERMISSIONS) {
            for (const r of p.defaultRoles) expect(ROLE_KEYS).toContain(r);
        }
    });

    it('agency admin gets every agency-portal permission except client-only ones', () => {
        const clientOnly = PERMISSIONS.filter((p) => p.defaultRoles.length === 1 && p.defaultRoles[0] === 'client');
        for (const p of PERMISSIONS) {
            if (clientOnly.includes(p)) continue;
            expect(defaultGrant('admin', p.key), p.key).toBe(true);
        }
    });

    it('seed matrix only references known features and covers every limit', () => {
        const featureKeys = new Set<string>(FEATURES.map((f) => f.key));
        for (const [plan, seed] of Object.entries(DEFAULT_PLAN_MATRIX)) {
            for (const f of seed.features) expect(featureKeys.has(f), `${plan}:${f}`).toBe(true);
            for (const l of LIMITS) expect(Number.isInteger(seed.limits[l.key]), `${plan}:${l.key}`).toBe(true);
        }
    });

    it('default grants only go to roles whose portal the feature appears in', () => {
        for (const p of PERMISSIONS) {
            for (const r of p.defaultRoles) expect(roleApplies(r, p.key), `${r}:${p.key}`).toBe(true);
        }
        expect(roleApplies('client', 'settings.update')).toBe(false);
        expect(roleApplies('creator', 'invoices.view')).toBe(false);
        expect(roleApplies('manager', 'invoices.view')).toBe(true);
        expect(roleApplies('client', 'documents.client_upload')).toBe(true);
        expect(roleApplies('admin', 'documents.client_upload')).toBe(false);
        expect(roleApplies('admin', 'documents.share')).toBe(true);
        expect(roleApplies('creator', 'documents.share')).toBe(false);
        expect(roleApplies('client', 'documents.share')).toBe(false);
        expect(defaultGrant('creator', 'documents.share')).toBe(false);
        expect(defaultGrant('client', 'documents.client_upload')).toBe(true);
        expect(defaultGrant('admin', 'documents.client_upload')).toBe(false);
    });

    it('featureOf handles keys with underscores', () => {
        expect(featureOf('client_portal.manage')).toBe('client_portal');
    });
});
