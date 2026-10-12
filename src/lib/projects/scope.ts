import { createServerSupabaseClient } from '@/lib/supabase/server';
import { clientScope, type ClientScope } from '@/lib/clients/scope';
import type { RoleKey } from '@/lib/registry/catalog';

export type WorkScope = { kind: 'all' } | { kind: 'projects'; ids: string[] };
export type VisibleProjects = { kind: 'all' } | { kind: 'ids'; ids: string[] };

const NONE = '00000000-0000-0000-0000-000000000000';

export interface MembershipRow {
    project_id: string;
    deleted: boolean;
}

const LEADS = new Set(['admin', 'manager']);

/** Pure: which projects a role may see from membership rows. */
export function workFromMemberships(role: string, rows: MembershipRow[]): WorkScope {
    if (LEADS.has(role)) return { kind: 'all' };
    const ids = rows.filter((row) => !row.deleted).map((row) => row.project_id);
    return { kind: 'projects', ids: [...new Set(ids)] };
}

export function workAllows(scope: WorkScope, projectId: string) {
    if (scope.kind === 'all') return true;
    return scope.ids.includes(projectId);
}

type ScopedQuery<Q> = Q & {
    in: (column: string, values: string[]) => Q;
    eq: (column: string, value: string) => Q;
};

export function applyWorkScope<Q>(query: ScopedQuery<Q>, scope: WorkScope, column = 'project_id'): Q {
    if (scope.kind === 'all') return query;
    if (scope.ids.length === 0) return query.eq(column, NONE);
    return query.in(column, scope.ids);
}

export function applyVisible<Q>(query: ScopedQuery<Q>, visible: VisibleProjects, column = 'id'): Q {
    if (visible.kind === 'all') return query;
    if (visible.ids.length === 0) return query.eq(column, NONE);
    return query.in(column, visible.ids);
}

export interface ProjectRow {
    id: string;
    client_id: string;
    deleted: boolean;
}

/** Projects a client may see: their clients only, and not deleted. */
export function projectsForClients(scope: ClientScope, projects: ProjectRow[]): string[] {
    if (scope.kind === 'all') return projects.filter((p) => !p.deleted).map((p) => p.id);
    const allowed = new Set(scope.ids);
    return projects.filter((p) => !p.deleted && allowed.has(p.client_id)).map((p) => p.id);
}

export async function workScope(agencyId: string, userId: string, role: RoleKey | string): Promise<WorkScope> {
    if (LEADS.has(role)) return { kind: 'all' };
    const supabase = createServerSupabaseClient();
    if (role === 'client') {
        const scope = await clientScope(agencyId, userId, role);
        if (scope.kind === 'clients' && scope.ids.length === 0) return { kind: 'projects', ids: [] };
        let query = supabase.from('projects').select('id, client_id, deleted_at').eq('agency_id', agencyId).is('deleted_at', null);
        if (scope.kind === 'clients') query = query.in('client_id', scope.ids);
        const { data } = await query;
        return { kind: 'projects', ids: (data ?? []).map((row) => row.id as string) };
    }
    const { data } = await supabase
        .from('project_members')
        .select('project_id, projects(deleted_at)')
        .eq('agency_id', agencyId)
        .eq('user_id', userId);
    const rows: MembershipRow[] = (data ?? []).map((row) => {
        const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;
        return { project_id: row.project_id as string, deleted: !!project?.deleted_at };
    });
    return workFromMemberships(role, rows);
}

/** One project-id filter for any role. Staff see all. Creators see memberships. Clients see their clients. */
export async function visibleProjectIds(agencyId: string, userId: string, role: RoleKey | string): Promise<VisibleProjects> {
    if (LEADS.has(role)) return { kind: 'all' };
    const scope = await workScope(agencyId, userId, role);
    return { kind: 'ids', ids: scope.kind === 'projects' ? scope.ids : [] };
}
