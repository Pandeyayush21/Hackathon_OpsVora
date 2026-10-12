import { randomUUID } from 'crypto';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { checkLimit } from '@/lib/access/entitlements';
import { sendTeamInviteEmail } from '@/lib/email/team-invite';
import { logActivity } from './activity';

export const INVITE_ROLES = ['admin', 'manager', 'creator'] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

const INVITE_DAYS = 7;

export function seatsUsed(activeNonClient: number, pendingInvites: number) {
    return activeNonClient + pendingInvites;
}

/** True when this change would leave the agency with no active admin. */
export function blocksLastAdmin(activeAdmins: number, currentRole: string, nextRole: string | null) {
    return currentRole === 'admin' && activeAdmins <= 1 && nextRole !== 'admin';
}

export function mapInviteError(error: { code?: string; message?: string } | null): { status: number; code: string; error: string } {
    const msg = error?.message ?? '';
    if (error?.code === '23505' || msg.includes('team_member_invites_pending_email')) {
        return { status: 409, code: 'ALREADY_INVITED', error: 'That email already has a pending invite.' };
    }
    return { status: 500, code: 'INVITE_FAILED', error: 'Could not create the invite.' };
}

export async function countSeats(agencyId: string): Promise<number> {
    const supabase = createServerSupabaseClient();
    const now = new Date().toISOString();
    const [members, invites] = await Promise.all([
        supabase.from('agency_members').select('user_id', { count: 'exact', head: true }).eq('agency_id', agencyId).eq('status', 'active').neq('role', 'client'),
        supabase.from('team_member_invites').select('id', { count: 'exact', head: true }).eq('agency_id', agencyId).eq('is_used', false).eq('is_revoked', false).gt('expires_at', now),
    ]);
    return seatsUsed(members.count ?? 0, invites.count ?? 0);
}

export async function countActiveAdmins(agencyId: string): Promise<number> {
    const supabase = createServerSupabaseClient();
    const { count } = await supabase.from('agency_members').select('user_id', { count: 'exact', head: true }).eq('agency_id', agencyId).eq('status', 'active').eq('role', 'admin');
    return count ?? 0;
}

function inviteToken() {
    return randomUUID();
}

export async function createTeamInvite(input: {
    agencyId: string;
    actorId: string;
    email: string;
    name: string;
    role: InviteRole;
    agencyName: string;
    brandColor: string | null;
    /** Offer letters email the candidate the offer instead, so the plain invite email is skipped. */
    skipEmail?: boolean;
    /** Overrides the default 7-day window (offer letters match the agreement expiry). */
    expiresAt?: string;
}) {
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { ok: false as const, status: 400, code: 'BAD_EMAIL', error: 'Enter a valid email address.' };
    }
    if (!INVITE_ROLES.includes(input.role)) {
        return { ok: false as const, status: 400, code: 'BAD_ROLE', error: 'Choose admin, manager, or creator.' };
    }

    const used = await countSeats(input.agencyId);
    const seats = await checkLimit(input.agencyId, 'teamMembers', used, 1);
    if (!seats.allowed) {
        return { ok: false as const, status: 402, code: 'PLAN_LIMIT', error: `Your plan allows ${seats.limit} team seats.`, limit: seats.limit, used: seats.used };
    }

    const supabase = createServerSupabaseClient();
    const token = inviteToken();
    const expires = input.expiresAt ?? new Date(Date.now() + INVITE_DAYS * 86400000).toISOString();
    const { data: created, error } = await supabase
        .from('team_member_invites')
        .insert({
            agency_id: input.agencyId,
            email,
            name: input.name.trim() || null,
            role: input.role,
            token,
            invited_by: input.actorId,
            expires_at: expires,
        })
        .select('id')
        .single();
    if (error) {
        const mapped = mapInviteError(error);
        return { ok: false as const, ...mapped };
    }

    const link = teamJoinLink(token);
    let warning: string | null = null;
    if (!input.skipEmail) {
        try {
            await sendTeamInviteEmail({
                to: email,
                name: input.name.trim(),
                agencyName: input.agencyName,
                role: input.role,
                link,
                brandColor: input.brandColor,
            });
        } catch (err) {
            console.error('[team] invite email failed:', err);
            warning = 'The invite was created, but the email could not be sent. Copy the link from the team page.';
        }
    }

    await logActivity({
        agencyId: input.agencyId,
        actorId: input.actorId,
        action: 'team.invite',
        target: email,
        metadata: { role: input.role },
    });

    return { ok: true as const, warning, expires_at: expires, inviteId: created?.id as string | undefined, token, link };
}

/** The /join link a team invite email points to. */
export function teamJoinLink(token: string) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    return `${appUrl.replace(/\/$/, '')}/join/${token}`;
}
