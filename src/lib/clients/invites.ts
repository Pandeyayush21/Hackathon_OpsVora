import { randomUUID } from 'crypto';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { sendClientInviteEmail } from '@/lib/email/client-invite';
import { logActivity } from '@/lib/agency/activity';

const DAYS = 7;

export function mapClientInviteError(error: { code?: string; message?: string } | null): { status: number; code: string; error: string } {
    const msg = error?.message ?? '';
    if (error?.code === '23505' || msg.includes('uq_client_invite_pending') || msg.includes('uq_client_contact_email')) {
        return { status: 409, code: 'ALREADY_INVITED', error: 'That contact already has a pending invite.' };
    }
    return { status: 500, code: 'INVITE_FAILED', error: 'Could not create the invite.' };
}

export async function createClientInvite(input: { agencyId: string; clientId: string; contactId: string; invitedBy: string }) {
    const supabase = createServerSupabaseClient();
    const { data: contact } = await supabase
        .from('client_contacts')
        .select('id, email, name, portal_status, client_id, agency_id')
        .eq('id', input.contactId)
        .eq('client_id', input.clientId)
        .eq('agency_id', input.agencyId)
        .maybeSingle();
    if (!contact) return { ok: false as const, status: 404, code: 'NOT_FOUND', error: 'Contact not found.' };
    if (!contact.email) return { ok: false as const, status: 400, code: 'NO_EMAIL', error: 'Add an email before inviting this contact.' };

    const { data: clientRow } = await supabase.from('clients').select('status').eq('id', input.clientId).is('deleted_at', null).maybeSingle();
    if (!clientRow || clientRow.status === 'archived') {
        return { ok: false as const, status: 409, code: 'CLIENT_ARCHIVED', error: 'Restore this client before inviting anyone to the portal.' };
    }

    // An expired invite still counts as pending for uq_client_invite_pending; retire it first.
    const now = new Date().toISOString();
    await supabase
        .from('client_portal_invites')
        .update({ is_revoked: true })
        .eq('contact_id', contact.id)
        .eq('is_used', false)
        .eq('is_revoked', false)
        .lte('expires_at', now);
    const { data: pending } = await supabase
        .from('client_portal_invites')
        .select('id, expires_at, is_revoked')
        .eq('contact_id', contact.id)
        .eq('is_used', false)
        .eq('is_revoked', false)
        .gt('expires_at', now)
        .maybeSingle();

    const canInvite = contact.portal_status === 'none' || contact.portal_status === 'disabled' || (contact.portal_status === 'invited' && !pending);
    if (contact.portal_status === 'active') {
        return { ok: false as const, status: 409, code: 'ALREADY_ACTIVE', error: 'This contact already has portal access.' };
    }
    if (pending) return { ok: false as const, status: 409, code: 'ALREADY_INVITED', error: 'That contact already has a pending invite.' };
    if (!canInvite) return { ok: false as const, status: 409, code: 'ALREADY_INVITED', error: 'That contact already has a pending invite.' };

    const token = randomUUID();
    const expires = new Date(Date.now() + DAYS * 86400000).toISOString();
    const { error } = await supabase.from('client_portal_invites').insert({
        token,
        agency_id: input.agencyId,
        client_id: input.clientId,
        contact_id: contact.id,
        email: contact.email,
        invited_by: input.invitedBy,
        expires_at: expires,
    });
    if (error) {
        const mapped = mapClientInviteError(error);
        return { ok: false as const, ...mapped };
    }
    await supabase.from('client_contacts').update({ portal_status: 'invited' }).eq('id', contact.id);

    const { data: agency } = await supabase.from('agencies').select('name, logo_url, theme_primary_color').eq('id', input.agencyId).single();
    const { data: client } = await supabase.from('clients').select('company_name').eq('id', input.clientId).single();
    const { data: inviter } = await supabase.from('profiles').select('full_name').eq('id', input.invitedBy).maybeSingle();
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3002').replace(/\/$/, '');
    const link = `${appUrl}/client-invite/${token}`;
    let emailSent = true;
    try {
        await sendClientInviteEmail({
            to: contact.email,
            agencyName: agency?.name ?? 'your agency',
            agencyLogoUrl: agency?.logo_url ?? null,
            brandColor: agency?.theme_primary_color ?? null,
            inviterName: inviter?.full_name ?? 'Your agency',
            clientName: client?.company_name ?? 'your company',
            link,
            expiresAt: expires,
        });
    } catch (err) {
        console.error('[clients] invite email failed:', err);
        emailSent = false;
    }
    await logActivity({
        agencyId: input.agencyId,
        actorId: input.invitedBy,
        action: 'client_portal.invite',
        target: contact.email,
        metadata: { client_id: input.clientId, contact_id: contact.id },
    });
    return { ok: true as const, email_sent: emailSent, link, expires_at: expires, token };
}
