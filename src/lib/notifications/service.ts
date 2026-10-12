import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { NotificationCategory, NotificationEmailMode, NotificationKind } from '@/lib/types/database';
import {
    CATEGORY_DEFAULTS,
    getCatalogueEntry,
    type CatalogueContext,
    type NotifyPortal,
} from './catalogue';
import { filterAudience, type AudienceEntity } from './audience';
import { sendNotificationEmail } from '@/lib/email/notifications';
import { userContacts } from '@/lib/auth/users';

export interface NotifyInput {
    agencyId: string;
    kind: NotificationKind | string;
    actorId: string | null;
    entity: AudienceEntity;
    recipients: string[];
    vars?: CatalogueContext;
    commentVisibility?: 'internal' | 'client';
}

async function loadAgency(agencyId: string) {
    const supabase = createServerSupabaseClient();
    const { data } = await supabase
        .from('agencies')
        .select('id, name, slug, logo_url, theme_primary_color')
        .eq('id', agencyId)
        .maybeSingle();
    return data;
}

/** Email (from auth.users), name and role *in this agency* for each recipient. */
async function loadProfiles(agencyId: string, userIds: string[]) {
    const map = new Map<string, { email: string | null; full_name: string | null; role?: string }>();
    if (!userIds.length) return map;
    const supabase = createServerSupabaseClient();
    const [contacts, { data: members }] = await Promise.all([
        userContacts(userIds),
        supabase.from('agency_members').select('user_id, role').eq('agency_id', agencyId).eq('status', 'active').in('user_id', userIds),
    ]);
    const roles = new Map((members ?? []).map((m) => [m.user_id as string, m.role as string]));
    for (const id of userIds) {
        const contact = contacts.get(id);
        map.set(id, { email: contact?.email ?? null, full_name: contact?.name ?? null, role: roles.get(id) });
    }
    return map;
}

async function loadPreferences(
    agencyId: string,
    userIds: string[],
    category: NotificationCategory,
): Promise<Map<string, { in_app: boolean; email: NotificationEmailMode }>> {
    const supabase = createServerSupabaseClient();
    const { data } = await supabase
        .from('notification_preferences')
        .select('user_id, in_app, email')
        .eq('agency_id', agencyId)
        .eq('category', category)
        .in('user_id', userIds);
    const map = new Map<string, { in_app: boolean; email: NotificationEmailMode }>();
    const fallback = CATEGORY_DEFAULTS[category] ?? 'daily';
    for (const id of userIds) {
        map.set(id, { in_app: true, email: fallback });
    }
    for (const row of data ?? []) {
        map.set(row.user_id, {
            in_app: row.in_app !== false,
            email: (row.email as NotificationEmailMode) || fallback,
        });
    }
    return map;
}

function portalForRole(role: string | undefined): NotifyPortal {
    return role === 'client' ? 'portal' : 'agency';
}

/**
 * Create in-app (+ optional email) notifications. Never throws into the caller.
 */
export async function notify(input: NotifyInput): Promise<void> {
    try {
        const entry = getCatalogueEntry(input.kind);
        if (!entry) {
            console.error('[notify] unknown kind', input.kind);
            return;
        }

        const entity: AudienceEntity =
            input.commentVisibility
                ? { ...input.entity, visibility: input.commentVisibility }
                : input.entity;

        let recipients = [...new Set(input.recipients.filter(Boolean))];
        if (input.actorId) recipients = recipients.filter((id) => id !== input.actorId);
        recipients = await filterAudience(input.agencyId, recipients, entity);
        if (!recipients.length) return;

        const agency = await loadAgency(input.agencyId);
        if (!agency) return;

        const vars: CatalogueContext = {
            ...input.vars,
            slug: input.vars?.slug || agency.slug,
            entityId: input.vars?.entityId || input.entity.id,
        };

        const prefs = await loadPreferences(input.agencyId, recipients, entry.category);
        const profiles = await loadProfiles(input.agencyId, recipients);
        const supabase = createServerSupabaseClient();

        const rows: Array<{
            agency_id: string;
            user_id: string;
            kind: string;
            category: string;
            title: string;
            body: string | null;
            link: string;
            entity_type: string | null;
            entity_id: string | null;
            actor_id: string | null;
            email_status: string;
            read_at: string | null;
        }> = [];

        const emailJobs: Array<{ userId: string; index: number; mode: NotificationEmailMode }> = [];

        for (const userId of recipients) {
            const pref = prefs.get(userId)!;
            if (!pref.in_app && pref.email === 'off') continue;

            const profile = profiles.get(userId);
            const portal = portalForRole(profile?.role);
            const title = entry.title(vars);
            const link = entry.link(vars, portal);
            const body = entry.body?.(vars) ?? null;
            const staffBody = profile?.role === 'client' ? null : body;

            let emailStatus = 'skipped';
            if (!entry.skipEmail && pref.email === 'instant') {
                emailStatus = 'none'; // updated after send
            } else if (!entry.skipEmail && pref.email === 'daily') {
                emailStatus = 'pending_digest';
            } else {
                emailStatus = 'skipped';
            }

            if (!pref.in_app) {
                // Still may email
                if (entry.skipEmail || pref.email === 'off') continue;
            }

            const index = rows.length;
            rows.push({
                agency_id: input.agencyId,
                user_id: userId,
                kind: entry.kind,
                category: entry.category,
                title,
                body: staffBody,
                link,
                entity_type: input.entity.type === 'agency' ? null : input.entity.type,
                entity_id: input.entity.type === 'agency' ? null : input.entity.id,
                actor_id: input.actorId,
                email_status: emailStatus,
                // In-app turned off: keep the record (the email links to it) but don't badge it.
                read_at: pref.in_app ? null : new Date().toISOString(),
            });

            if (!entry.skipEmail && pref.email === 'instant' && profile?.email) {
                emailJobs.push({ userId, index, mode: 'instant' });
            }
        }

        if (!rows.length) return;

        const { data: inserted, error } = await supabase.from('notifications').insert(rows).select('id');
        if (error) {
            console.error('[notify] insert failed', error.message);
            return;
        }

        for (const job of emailJobs) {
            const row = rows[job.index];
            const profile = profiles.get(job.userId);
            if (!profile?.email) continue;
            const notifId = inserted?.[job.index]?.id;
            try {
                const ok = await sendNotificationEmail({
                    to: profile.email,
                    agency: {
                        name: agency.name,
                        slug: agency.slug,
                        logo_url: agency.logo_url,
                        theme_primary_color: agency.theme_primary_color,
                    },
                    title: row.title,
                    preview: row.body,
                    link: row.link,
                });
                if (notifId) {
                    await supabase
                        .from('notifications')
                        .update({ email_status: ok ? 'sent' : 'failed' })
                        .eq('id', notifId);
                }
            } catch (err) {
                console.error('[notify] email failed', err);
                if (notifId) {
                    await supabase.from('notifications').update({ email_status: 'failed' }).eq('id', notifId);
                }
            }
        }
    } catch (err) {
        console.error('[notify] failed', err);
    }
}

export async function listNotifications(input: {
    agencyId: string;
    userId: string;
    cursor?: string | null;
    limit?: number;
}) {
    const supabase = createServerSupabaseClient();
    const limit = Math.min(input.limit ?? 20, 50);
    let q = supabase
        .from('notifications')
        .select('*')
        .eq('agency_id', input.agencyId)
        .eq('user_id', input.userId)
        .order('created_at', { ascending: false })
        .limit(limit + 1);
    if (input.cursor) q = q.lt('created_at', input.cursor);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
        items,
        nextCursor: hasMore ? items[items.length - 1]?.created_at ?? null : null,
    };
}

export async function unreadCount(agencyId: string, userId: string): Promise<number> {
    const supabase = createServerSupabaseClient();
    const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('agency_id', agencyId)
        .eq('user_id', userId)
        .is('read_at', null);
    if (error) {
        console.error('[notify] unread count failed', error.message);
        return 0;
    }
    return count ?? 0;
}

export async function markRead(input: {
    agencyId: string;
    userId: string;
    ids?: string[];
    all?: boolean;
}) {
    const supabase = createServerSupabaseClient();
    const now = new Date().toISOString();
    let q = supabase
        .from('notifications')
        .update({ read_at: now })
        .eq('agency_id', input.agencyId)
        .eq('user_id', input.userId)
        .is('read_at', null);
    if (!input.all && input.ids?.length) {
        q = q.in('id', input.ids);
    } else if (!input.all) {
        return { updated: 0 };
    }
    const { data, error } = await q.select('id');
    if (error) throw new Error(error.message);
    return { updated: data?.length ?? 0 };
}

export async function getPreferences(agencyId: string, userId: string) {
    const supabase = createServerSupabaseClient();
    const { data } = await supabase
        .from('notification_preferences')
        .select('category, in_app, email')
        .eq('agency_id', agencyId)
        .eq('user_id', userId);
    const byCat = new Map((data ?? []).map((r) => [r.category, r]));
    return Object.entries(CATEGORY_DEFAULTS).map(([category, email]) => {
        const row = byCat.get(category);
        return {
            category: category as NotificationCategory,
            in_app: row?.in_app ?? true,
            email: (row?.email as NotificationEmailMode) ?? email,
        };
    });
}

export async function setPreferences(
    agencyId: string,
    userId: string,
    items: Array<{ category: string; in_app: boolean; email: NotificationEmailMode }>,
) {
    const supabase = createServerSupabaseClient();
    const now = new Date().toISOString();
    const rows = items.map((item) => ({
        user_id: userId,
        agency_id: agencyId,
        category: item.category,
        in_app: item.in_app,
        email: item.email,
        updated_at: now,
    }));
    const { error } = await supabase.from('notification_preferences').upsert(rows);
    if (error) throw new Error(error.message);
    return getPreferences(agencyId, userId);
}
