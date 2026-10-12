import { cache } from 'react';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { resolveHomes, type Home } from '@/lib/auth/home';
import { findMembership } from '@/lib/access/guards';
import { getEntitlements } from '@/lib/access/entitlements';
import { getRoleGrants, permissionsForRole } from '@/lib/access/roles';
import { accessMode, evaluateGranted, graceDaysLeft, trialDaysLeft, type AccessMode, type DenyCode } from '@/lib/access/modes';
import { ROLES, type PermissionKey } from '@/lib/registry/catalog';
import type { Entitlements } from '@/lib/access/resolve';

const HOUR_MS = 3_600_000;

export interface PortalAgency {
    id: string;
    name: string;
    slug: string;
    logo_url: string | null;
    theme_primary_color: string | null;
    website_url: string | null;
}

export interface PortalContext {
    userId: string;
    email: string;
    agency: PortalAgency;
    fullName: string | null;
    role: string;
    roleName: string;
    homes: Home[];
    entitlements: Entitlements;
    permissions: PermissionKey[];
    mode: AccessMode;
    trialDaysLeft: number | null;
    graceDaysLeft: number | null;
    /** Client portal only: an agreement the contact must sign before anything else opens. */
    clientGate?: string | null;
}

/** Agency, membership, plan and permissions for this request. Shared by the layout and every page. */
export const getPortalContext = cache(async (slug: string): Promise<PortalContext> => {
    const h = await headers();
    const userId = h.get('x-user-id');
    if (!userId) redirect(`/login?next=/agency/${encodeURIComponent(slug)}`);

    const supabase = createServerSupabaseClient();
    const { data: agency } = await supabase
        .from('agencies')
        .select('id, name, slug, logo_url, theme_primary_color, website_url')
        .eq('slug', slug)
        .maybeSingle();
    if (!agency) notFound();

    const [member, { data: profile }, entitlements, grants, homes] = await Promise.all([
        findMembership(userId, agency.id),
        supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle(),
        getEntitlements(agency.id),
        getRoleGrants(),
        resolveHomes(userId),
    ]);

    if (!member || !entitlements) {
        const elsewhere = homes.find((home) => home.href !== `/agency/${slug}`);
        redirect(elsewhere?.href ?? '/login');
    }

    const lastUsed = member.last_used_at ? new Date(member.last_used_at).getTime() : 0;
    if (member.last_used_at !== undefined && Date.now() - lastUsed > HOUR_MS) {
        await supabase
            .from('agency_members')
            .update({ last_used_at: new Date().toISOString() })
            .eq('user_id', userId)
            .eq('agency_id', agency.id);
    }

    const mode = accessMode(entitlements);
    return {
        userId,
        email: h.get('x-user-email') ?? '',
        agency,
        fullName: profile?.full_name ?? null,
        role: member.role,
        roleName: ROLES.find((r) => r.key === member.role)?.name ?? member.role,
        homes,
        entitlements,
        permissions: permissionsForRole(grants, member.role),
        mode,
        trialDaysLeft: trialDaysLeft(entitlements),
        graceDaysLeft: graceDaysLeft(entitlements),
    };
});

export function pageDeny(ctx: PortalContext, permission: PermissionKey): DenyCode | null {
    return evaluateGranted({
        mode: ctx.mode,
        features: ctx.entitlements.features,
        granted: ctx.permissions.includes(permission),
        permission,
    });
}

/** Page guard. A missing permission is a 404; a missing plan feature is reported so the page can offer an upgrade. */
export async function requirePageAccess(slug: string, permission: PermissionKey): Promise<PortalContext> {
    const ctx = await getPortalContext(slug);
    const code = pageDeny(ctx, permission);
    if (code === 'FORBIDDEN' || code === 'AGENCY_SUSPENDED') notFound();
    return ctx;
}
