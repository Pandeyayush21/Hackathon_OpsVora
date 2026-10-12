import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { RoleKey } from '@/lib/registry/catalog';

export type ClientScope = { kind: 'all' } | { kind: 'clients'; ids: string[] };

const NONE = '00000000-0000-0000-0000-000000000000';

export interface ScopeContact {
    client_id: string;
    portal_status: string;
    deleted: boolean;
}

/** Pure: which client ids a role may see, given the contact rows we loaded. */
export function scopeFromContacts(role: string, contacts: ScopeContact[]): ClientScope {
    if (role !== 'client') return { kind: 'all' };
    const ids = contacts.filter((c) => c.portal_status === 'active' && !c.deleted).map((c) => c.client_id);
    return { kind: 'clients', ids: [...new Set(ids)] };
}

export function scopeAllows(scope: ClientScope, clientId: string) {
    if (scope.kind === 'all') return true;
    return scope.ids.includes(clientId);
}

type ScopedQuery<Q> = Q & {
    in: (column: string, values: string[]) => Q;
    eq: (column: string, value: string) => Q;
};

export function applyScope<Q>(query: ScopedQuery<Q>, scope: ClientScope, column = 'client_id'): Q {
    if (scope.kind === 'all') return query;
    if (scope.ids.length === 0) return query.eq(column, NONE);
    return query.in(column, scope.ids);
}

export async function clientScope(agencyId: string, userId: string, role: RoleKey | string): Promise<ClientScope> {
    if (role !== 'client') return { kind: 'all' };
    const supabase = createServerSupabaseClient();
    const { data } = await supabase
        .from('client_contacts')
        .select('client_id, portal_status, clients(deleted_at)')
        .eq('agency_id', agencyId)
        .eq('user_id', userId);
    const contacts: ScopeContact[] = (data ?? []).map((row) => {
        const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
        return {
            client_id: row.client_id as string,
            portal_status: row.portal_status as string,
            deleted: !!client?.deleted_at,
        };
    });
    return scopeFromContacts('client', contacts);
}
