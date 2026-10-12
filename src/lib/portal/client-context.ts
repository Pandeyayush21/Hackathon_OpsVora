import { cache } from 'react';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getPortalContext, type PortalContext } from './context';
import { clientScope, type ClientScope } from '@/lib/clients/scope';
import { isStaffMember } from '@/lib/clients/clients';

export interface ClientPortalData {
    ctx: PortalContext;
    scope: ClientScope;
    client: { id: string; company_name: string; logo_url: string | null; status: string } | null;
    contact: { id: string; name: string; portal_status: string } | null;
    agencyContact: { name: string; email: string | null } | null;
    ended: boolean;
}

/** Owner, or the first active admin when the client has no owner. */
export async function agencyContactFor(agencyId: string, ownerId: string | null) {
    const supabase = createServerSupabaseClient();
    let profileId = ownerId && (await isStaffMember(agencyId, ownerId)) ? ownerId : null;
    if (!profileId) {
        const { data: admin } = await supabase.from('agency_members').select('user_id').eq('agency_id', agencyId).eq('role', 'admin').eq('status', 'active').limit(1).maybeSingle();
        profileId = admin?.user_id ?? null;
    }
    if (!profileId) return null;
    const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', profileId).maybeSingle();
    const { data: user } = await supabase.auth.admin.getUserById(profileId);
    return { name: profile?.full_name || 'Your agency contact', email: user.user?.email ?? null };
}

export const getClientPortalContext = cache(async (slug: string): Promise<ClientPortalData> => {
    const ctx = await getPortalContext(slug);
    const supabase = createServerSupabaseClient();
    const scope = await clientScope(ctx.agency.id, ctx.userId, ctx.role);
    const { data: contact } = await supabase
        .from('client_contacts')
        .select('id, name, portal_status, client_id, clients(id, company_name, logo_url, status, deleted_at, owner_id)')
        .eq('agency_id', ctx.agency.id)
        .eq('user_id', ctx.userId)
        .eq('portal_status', 'active')
        .maybeSingle();

    const clientRow = contact ? (Array.isArray(contact.clients) ? contact.clients[0] : contact.clients) : null;
    const ended = !contact || !clientRow || !!clientRow.deleted_at || clientRow.status === 'archived';

    const agencyContact = !ended && clientRow
        ? await agencyContactFor(ctx.agency.id, (clientRow.owner_id as string | null) ?? null)
        : null;

    // "Must sign before using the portal": record it on the context so every section check
    // (pages and portal APIs, via clientCanSee) refuses until it's signed, not just the layout.
    ctx.clientGate = null;
    if (contact && !ended && ctx.entitlements.features.agreements === true) {
        const { data: gate } = await supabase
            .from('agreements')
            .select('id')
            .eq('agency_id', ctx.agency.id)
            .eq('contact_id', contact.id)
            .eq('gate_portal', true)
            .in('status', ['sent', 'viewed'])
            .is('deleted_at', null)
            .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
            .limit(1)
            .maybeSingle();
        ctx.clientGate = (gate?.id as string | undefined) ?? null;
    }

    return {
        ctx,
        scope,
        ended,
        contact: contact ? { id: contact.id, name: contact.name, portal_status: contact.portal_status } : null,
        client: clientRow && !ended ? { id: clientRow.id, company_name: clientRow.company_name, logo_url: clientRow.logo_url, status: clientRow.status } : null,
        agencyContact,
    };
});

/** A client can open a portal section only when the workspace is up, the plan has the feature and the client role holds the permission. */
export function clientCanSee(
    ctx: Pick<PortalContext, 'mode' | 'entitlements' | 'permissions' | 'clientGate'>,
    feature: string,
    permission: string
): boolean {
    // A pending "sign first" agreement closes every other section until it's signed.
    if (ctx.clientGate && feature !== 'agreements') return false;
    return ctx.mode !== 'blocked' && ctx.entitlements.features[feature] === true && (ctx.permissions as readonly string[]).includes(permission);
}
