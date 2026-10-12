import { createServerSupabaseClient } from '@/lib/supabase/server';

// Where a signed-in person belongs. One login page for every portal:
//   platform admin → /super-admin (first, by default)
//   each agency membership → that agency's workspace, most recently used first
// Team and client portals will get their own routes; only this function changes then.

export type HomeKind = 'platform' | 'agency' | 'team' | 'client';

export interface Home {
    kind: HomeKind;
    href: string;
    label: string;
    /** Agency homes only */
    agency?: { id: string; slug: string; name: string; logoUrl: string | null; color: string | null; role: string };
}

interface MembershipRow {
    role: string;
    last_used_at: string | null;
    created_at: string;
    agencies: { id: string; slug: string; name: string; logo_url: string | null; theme_primary_color: string | null } | null;
}

function kindForRole(role: string): HomeKind {
    return role === 'client' ? 'client' : role === 'creator' ? 'team' : 'agency';
}

/** Most recently used first; never-used memberships by join date (newest first). */
export function sortMemberships<T extends { last_used_at: string | null; created_at: string }>(rows: T[]): T[] {
    const t = (r: T) => new Date(r.last_used_at ?? 0).getTime();
    return [...rows].sort((a, b) => t(b) - t(a) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function resolveHomes(userId: string): Promise<Home[]> {
    const supabase = createServerSupabaseClient();
    const [{ data: admin }, members] = await Promise.all([
        supabase.from('platform_admins').select('id').eq('user_id', userId).maybeSingle(),
        supabase
            .from('agency_members')
            .select('role, last_used_at, created_at, agency_id')
            .eq('user_id', userId)
            .eq('status', 'active'),
    ]);

    if (members.error) console.error('agency_members read failed:', members.error.message);
    let memberships: MembershipRow[] = [];
    if (members.data?.length) {
        const ids = members.data.map((m) => m.agency_id);
        const { data: agencies } = await supabase
            .from('agencies')
            .select('id, slug, name, logo_url, theme_primary_color')
            .in('id', ids);
        const byId = new Map((agencies ?? []).map((a) => [a.id, a]));
        memberships = members.data.map((m) => ({
            role: m.role,
            last_used_at: m.last_used_at,
            created_at: m.created_at,
            agencies: byId.get(m.agency_id) ?? null,
        }));
    }

    const homes: Home[] = [];
    if (admin) homes.push({ kind: 'platform', href: '/super-admin', label: 'OpsVora admin' });

    for (const m of sortMemberships(memberships)) {
        const a = Array.isArray(m.agencies) ? m.agencies[0] : m.agencies;
        if (!a?.slug) continue;
        homes.push({
            kind: kindForRole(m.role),
            href: m.role === 'client' ? `/portal/${a.slug}` : `/agency/${a.slug}`,
            label: a.name,
            agency: { id: a.id, slug: a.slug, name: a.name, logoUrl: a.logo_url, color: a.theme_primary_color, role: m.role },
        });
    }
    return homes;
}

/** Only same-site relative paths are allowed as a post-login destination. */
export function safeNext(next: unknown): string | null {
    if (typeof next !== 'string') return null;
    if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
    if (next.startsWith('/login') || next.startsWith('/api/')) return null;
    return next;
}

/** Pick the destination: a requested page the person can plausibly use, else their primary home. */
export function pickDestination(homes: Home[], next: string | null): string | null {
    if (homes.length === 0) return null;
    if (next) {
        const isAdminPath = next.startsWith('/super-admin');
        const canAdmin = homes.some((h) => h.kind === 'platform');
        if (!isAdminPath || canAdmin) return next;
    }
    return homes[0].href;
}
