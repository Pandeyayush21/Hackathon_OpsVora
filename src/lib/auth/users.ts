import { createServerSupabaseClient } from '@/lib/supabase/server';

export interface UserContact {
    email: string | null;
    name: string | null;
}

/**
 * Email and display name for a set of users. Emails live on auth.users (profiles has no email
 * column), so they come from the auth admin API; names come from profiles.full_name.
 * Lookups run in small parallel batches.
 */
export async function userContacts(userIds: string[]): Promise<Map<string, UserContact>> {
    const ids = [...new Set(userIds.filter(Boolean))];
    const map = new Map<string, UserContact>();
    if (!ids.length) return map;
    const supabase = createServerSupabaseClient();

    const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', ids);
    const names = new Map((profiles ?? []).map((p) => [p.id as string, (p.full_name as string | null) ?? null]));

    for (let i = 0; i < ids.length; i += 10) {
        const batch = ids.slice(i, i + 10);
        const results = await Promise.all(batch.map((id) => supabase.auth.admin.getUserById(id).catch(() => null)));
        batch.forEach((id, index) => {
            const user = results[index]?.data?.user ?? null;
            map.set(id, { email: user?.email ?? null, name: names.get(id) ?? (user?.user_metadata?.full_name as string | undefined) ?? null });
        });
    }
    return map;
}

/** Display name with a safe fallback (never the email address). */
export function displayName(contact: UserContact | undefined, fallback = 'Someone') {
    return contact?.name?.trim() || fallback;
}
