import { unstable_cache } from 'next/cache';
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { FeatureKey, LimitKey } from '@/lib/registry/catalog';
import { ACCESS_TAGS } from './invalidate';
import { isWithinLimit, parseEntitlements, type Entitlements } from './resolve';

/**
 * Resolved plan features + limits for an agency (override → plan → default).
 * Cached per agency; invalidated by invalidateEntitlements() on admin edits.
 */
export function getEntitlements(agencyId: string): Promise<Entitlements | null> {
    return unstable_cache(
        async () => {
            const supabase = createServerSupabaseClient();
            const { data, error } = await supabase.rpc('get_agency_entitlements', { p_agency_id: agencyId });
            if (error) throw new Error(`get_agency_entitlements failed: ${error.message}`);
            return parseEntitlements(data);
        },
        ['entitlements', agencyId],
        { tags: [ACCESS_TAGS.entitlements, ACCESS_TAGS.agency(agencyId)], revalidate: 300 }
    )();
}

export async function hasFeature(agencyId: string, feature: FeatureKey | string): Promise<boolean> {
    const ent = await getEntitlements(agencyId);
    return ent?.features[feature] === true;
}

export async function getLimit(agencyId: string, limit: LimitKey): Promise<number> {
    const ent = await getEntitlements(agencyId);
    return ent?.limits[limit] ?? 0;
}

export interface LimitCheck {
    allowed: boolean;
    limit: number;
    used: number;
}

/** `used` is the caller's current count (each feature knows how to count its own rows). */
export async function checkLimit(agencyId: string, limit: LimitKey, used: number, adding = 1): Promise<LimitCheck> {
    const value = await getLimit(agencyId, limit);
    return { allowed: isWithinLimit(value, used, adding), limit: value, used };
}

export function limitExceededResponse(limit: LimitKey, check: LimitCheck) {
    return NextResponse.json(
        {
            error: `Your plan allows ${check.limit} ${limit}. Upgrade to add more.`,
            code: 'PLAN_LIMIT',
            limit_key: limit,
            limit: check.limit,
            used: check.used,
        },
        { status: 402 }
    );
}
