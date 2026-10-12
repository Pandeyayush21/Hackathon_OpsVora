import { NextRequest, NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { getAuthUser, type AuthErrorResult } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { featureOf, type PermissionKey } from '@/lib/registry/catalog';
import { getEntitlements } from './entitlements';
import { getRoleGrants } from './roles';
import { accessMode, DENY, evaluateAccess, type AccessMode } from './modes';
import type { Entitlements } from './resolve';

export interface AgencyMember {
    user_id: string;
    agency_id: string;
    role: string;
    last_used_at?: string | null;
}

export type AgencyMemberResult = AuthErrorResult | { user: User; member: AgencyMember };
export type AccessResult =
    | AuthErrorResult
    | { user: User; member: AgencyMember; entitlements: Entitlements; mode: AccessMode };

function deny(status: number, code: string, error: string, extra?: Record<string, unknown>): AuthErrorResult {
    return { error: NextResponse.json({ error, code, ...extra }, { status }) };
}

/**
 * Active membership of `userId` in `agencyId`, or null.
 * agency_members is the only source of truth: a disabled or missing row means no access.
 */
export async function findMembership(userId: string, agencyId: string): Promise<AgencyMember | null> {
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
        .from('agency_members')
        .select('user_id, agency_id, role, last_used_at')
        .eq('user_id', userId)
        .eq('agency_id', agencyId)
        .eq('status', 'active')
        .maybeSingle();
    if (error) console.error('agency_members lookup failed:', error.message);
    return data ?? null;
}

/** Authenticated user who belongs to `agencyId` (any role). */
export async function getAgencyMember(request: NextRequest, agencyId: string): Promise<AgencyMemberResult> {
    const auth = await getAuthUser(request);
    if ('error' in auth) return auth;

    const member = await findMembership(auth.user.id, agencyId);
    if (!member) return deny(403, 'NOT_AGENCY_MEMBER', 'You are not a member of this workspace');
    return { user: auth.user, member };
}

/**
 * The single guard for every agency/team/client API route:
 *   member of agency ∧ workspace not paused ∧ plan includes the permission's
 *   feature ∧ role is granted the permission ∧ (read-only mode ⇒ it's a read).
 *
 *   const access = await requireAccess(req, agencyId, 'invoices.create');
 *   if ('error' in access) return access.error;
 */
export async function requireAccess(
    request: NextRequest,
    agencyId: string,
    permission: PermissionKey
): Promise<AccessResult> {
    const result = await getAgencyMember(request, agencyId);
    if ('error' in result) return result;

    const [entitlements, grants] = await Promise.all([getEntitlements(agencyId), getRoleGrants()]);
    if (!entitlements) return deny(404, 'AGENCY_NOT_FOUND', 'Workspace not found');

    const mode = accessMode(entitlements);
    const code = evaluateAccess({ mode, features: entitlements.features, grants, role: result.member.role, permission });
    if (code) {
        const extra = code === 'FEATURE_NOT_IN_PLAN' ? { feature: featureOf(permission) } : code === 'FORBIDDEN' ? { permission } : undefined;
        return deny(DENY[code].status, code, DENY[code].message, extra);
    }

    return { ...result, entitlements, mode };
}
