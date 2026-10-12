// Pure entitlement resolution. Mirrors public.get_agency_entitlements()
// (supabase/migrations/029_registry_rbac.sql) — keep the two in sync.
//
// Features: coming_soon/deprecated → off; else override → plan → is_core.
// Limits:   override → plan → definition default. (-1 = unlimited)

import { UNLIMITED } from '@/lib/registry/catalog';

export type EntitlementSource = 'override' | 'plan' | 'default' | 'status';

export interface Entitlements {
    agencyId: string;
    plan: { id: string; key: string; name: string } | null;
    isSuspended: boolean;
    subscriptionStatus: string;
    currentPeriodEnd: string | null;
    pastDueSince: string | null;
    features: Record<string, boolean>;
    limits: Record<string, number>;
}

export interface ResolveInput {
    features: { key: string; status: string; is_core: boolean }[];
    planFeatures: { feature_key: string; enabled: boolean }[];
    featureOverrides: { feature_key: string; enabled: boolean; expires_at: string | null }[];
    limitDefs: { key: string; default_value: number }[];
    planLimits: { limit_key: string; value: number }[];
    limitOverrides: { limit_key: string; value: number; expires_at: string | null }[];
    now?: Date;
}

export interface ResolvedFeature {
    enabled: boolean;
    source: EntitlementSource;
}

export interface ResolvedLimit {
    value: number;
    source: EntitlementSource;
}

function active(expiresAt: string | null, now: Date) {
    return !expiresAt || new Date(expiresAt) > now;
}

export function resolveDetailed(input: ResolveInput) {
    const now = input.now ?? new Date();

    const planF = new Map(input.planFeatures.map((r) => [r.feature_key, r.enabled]));
    const overF = new Map(
        input.featureOverrides.filter((o) => active(o.expires_at, now)).map((o) => [o.feature_key, o.enabled])
    );
    const features: Record<string, ResolvedFeature> = {};
    for (const f of input.features) {
        if (f.status === 'coming_soon' || f.status === 'deprecated') {
            features[f.key] = { enabled: false, source: 'status' };
        } else if (overF.has(f.key)) {
            features[f.key] = { enabled: overF.get(f.key)!, source: 'override' };
        } else if (planF.has(f.key)) {
            features[f.key] = { enabled: planF.get(f.key)!, source: 'plan' };
        } else {
            features[f.key] = { enabled: f.is_core, source: 'default' };
        }
    }

    const planL = new Map(input.planLimits.map((r) => [r.limit_key, r.value]));
    const overL = new Map(
        input.limitOverrides.filter((o) => active(o.expires_at, now)).map((o) => [o.limit_key, o.value])
    );
    const limits: Record<string, ResolvedLimit> = {};
    for (const d of input.limitDefs) {
        if (overL.has(d.key)) limits[d.key] = { value: overL.get(d.key)!, source: 'override' };
        else if (planL.has(d.key)) limits[d.key] = { value: planL.get(d.key)!, source: 'plan' };
        else limits[d.key] = { value: d.default_value, source: 'default' };
    }

    return { features, limits };
}

export function resolveEntitlements(input: ResolveInput) {
    const { features, limits } = resolveDetailed(input);
    return {
        features: Object.fromEntries(Object.entries(features).map(([k, v]) => [k, v.enabled])),
        limits: Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, v.value])),
    };
}

/** Would adding `adding` more items stay within `limit`? */
export function isWithinLimit(limit: number, used: number, adding = 1): boolean {
    return limit === UNLIMITED || used + adding <= limit;
}

/** Map the RPC's snake_case JSON to Entitlements. */
export function parseEntitlements(raw: unknown): Entitlements | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    return {
        agencyId: String(r.agency_id),
        plan: (r.plan as Entitlements['plan']) ?? null,
        isSuspended: r.is_suspended === true,
        subscriptionStatus: String(r.subscription_status ?? 'active'),
        currentPeriodEnd: (r.current_period_end as string | null) ?? null,
        pastDueSince: (r.past_due_since as string | null) ?? null,
        features: (r.features as Record<string, boolean>) ?? {},
        limits: (r.limits as Record<string, number>) ?? {},
    };
}
