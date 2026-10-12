import { createServerSupabaseClient } from '@/lib/supabase/server';
import { checkLimit } from '@/lib/access/entitlements';
import { getUsage } from '@/lib/portal/usage';
import type { Client } from '@/lib/types/database';

export async function getClient(agencyId: string, clientId: string): Promise<Client | null> {
    const supabase = createServerSupabaseClient();
    const { data } = await supabase.from('clients').select('*').eq('agency_id', agencyId).eq('id', clientId).is('deleted_at', null).maybeSingle();
    return (data as Client | null) ?? null;
}

/** Archived clients still occupy a seat. Only a delete frees one. */
export async function clientSeatCheck(agencyId: string) {
    const usage = await getUsage(agencyId);
    return checkLimit(agencyId, 'clients', usage.clients, 1);
}

/** True when `userId` is an active non-client member of the agency. */
export async function isStaffMember(agencyId: string, userId: string): Promise<boolean> {
    const supabase = createServerSupabaseClient();
    const { data } = await supabase
        .from('agency_members')
        .select('user_id')
        .eq('agency_id', agencyId)
        .eq('user_id', userId)
        .eq('status', 'active')
        .neq('role', 'client')
        .maybeSingle();
    return !!data;
}

/**
 * Ends portal access for every contact of a client. `release` (used on delete) also
 * unlinks their logins so the same people can be invited for another client later.
 */
export async function teardownPortalAccess(agencyId: string, clientId: string, opts: { release?: boolean } = {}) {
    const supabase = createServerSupabaseClient();
    const { data: contacts } = await supabase.from('client_contacts').select('id, user_id').eq('agency_id', agencyId).eq('client_id', clientId);
    const rows = contacts ?? [];
    const ids = rows.map((c) => c.id);
    const userIds = rows.map((c) => c.user_id).filter((id): id is string => !!id);
    if (ids.length) {
        await supabase
            .from('client_contacts')
            .update(opts.release ? { portal_status: 'disabled', user_id: null } : { portal_status: 'disabled' })
            .in('id', ids);
        await supabase.from('client_portal_invites').update({ is_revoked: true }).eq('client_id', clientId).eq('is_used', false).eq('is_revoked', false);
    }
    if (userIds.length) {
        await supabase.from('agency_members').update({ status: 'disabled' }).eq('agency_id', agencyId).eq('role', 'client').in('user_id', userIds);
    }
}
