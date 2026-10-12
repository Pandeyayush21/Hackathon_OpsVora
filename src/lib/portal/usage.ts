import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { LimitKey } from '@/lib/registry/catalog';

export interface Usage {
    teamMembers: number;
    clients: number;
    projects: number;
    storageMB: number;
    agreementsMonthly: number;
}

const MB = 1024 * 1024;

async function countOf(query: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
    const { count, error } = await query;
    if (error) return 0;
    return count ?? 0;
}

/** First instant of the current calendar month in UTC. Monthly limits reset here. */
export function monthStartIso(now = new Date()): string {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Agreements this agency has sent in the current UTC month. */
export async function countAgreementsThisMonth(agencyId: string): Promise<number> {
    const supabase = createServerSupabaseClient();
    return countOf(
        supabase
            .from('agreements')
            .select('id', { count: 'exact', head: true })
            .eq('agency_id', agencyId)
            .not('sent_at', 'is', null)
            .gte('sent_at', monthStartIso())
    );
}

export async function getUsage(agencyId: string): Promise<Usage> {
    const supabase = createServerSupabaseClient();
    const now = new Date().toISOString();
    const [team, pending, clients, projects, storage, agreements] = await Promise.all([
        countOf(supabase.from('agency_members').select('user_id', { count: 'exact', head: true }).eq('agency_id', agencyId).eq('status', 'active').neq('role', 'client')),
        countOf(
            supabase
                .from('team_member_invites')
                .select('id', { count: 'exact', head: true })
                .eq('agency_id', agencyId)
                .eq('is_used', false)
                .eq('is_revoked', false)
                .gt('expires_at', now)
        ),
        countOf(supabase.from('clients').select('id', { count: 'exact', head: true }).eq('agency_id', agencyId).is('deleted_at', null)),
        countOf(
            supabase
                .from('projects')
                .select('id', { count: 'exact', head: true })
                .eq('agency_id', agencyId)
                .is('deleted_at', null)
                .in('status', ['active', 'on_hold', 'draft'])
        ),
        supabase.from('agencies').select('storage_used_bytes').eq('id', agencyId).maybeSingle(),
        countAgreementsThisMonth(agencyId),
    ]);
    return {
        teamMembers: team + pending,
        clients,
        projects,
        storageMB: Math.ceil(Number(storage.data?.storage_used_bytes ?? 0) / MB),
        agreementsMonthly: agreements,
    };
}

export const USAGE_CARDS: { key: LimitKey; label: string; of: keyof Usage; monthly?: boolean }[] = [
    { key: 'teamMembers', label: 'Team members', of: 'teamMembers' },
    { key: 'clients', label: 'Clients', of: 'clients' },
    { key: 'projects', label: 'Projects', of: 'projects' },
    { key: 'storageMB', label: 'Storage', of: 'storageMB' },
    { key: 'agreementsMonthly', label: 'Agreements sent', of: 'agreementsMonthly', monthly: true },
];
