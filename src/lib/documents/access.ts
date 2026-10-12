import { clientScope } from '@/lib/clients/scope';
import { visibleProjectIds, workScope } from '@/lib/projects/scope';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { Document, DocumentVisibility } from '@/lib/types/database';

export type DocumentScope =
    | { kind: 'all' }
    | { kind: 'filter'; clientIds: string[]; projectIds: string[] | null; visibility?: DocumentVisibility };

const NONE = '00000000-0000-0000-0000-000000000000';

export async function documentScope(agencyId: string, userId: string, role: string): Promise<DocumentScope> {
    if (role === 'admin' || role === 'manager') return { kind: 'all' };
    if (role === 'client') {
        const scope = await clientScope(agencyId, userId, role);
        const ids = scope.kind === 'all' ? [] : scope.ids;
        return { kind: 'filter', clientIds: ids.length ? ids : [NONE], projectIds: null, visibility: 'client' };
    }
    // Creator: clients with a member project; only unlinked docs or docs on member projects.
    const work = await workScope(agencyId, userId, role);
    const projectIds = work.kind === 'projects' ? work.ids : [];
    if (!projectIds.length) return { kind: 'filter', clientIds: [NONE], projectIds: [NONE] };
    const supabase = createServerSupabaseClient();
    const { data } = await supabase.from('projects').select('client_id').eq('agency_id', agencyId).in('id', projectIds).is('deleted_at', null);
    const clientIds = [...new Set((data ?? []).map((row) => row.client_id as string))];
    return { kind: 'filter', clientIds: clientIds.length ? clientIds : [NONE], projectIds };
}

export interface ScopedDocument extends Document {
    client_name: string;
    project_name: string | null;
    client_deleted_at: string | null;
}

export async function documentInScope(
    agencyId: string,
    userId: string,
    role: string,
    documentId: string
): Promise<ScopedDocument | null> {
    const supabase = createServerSupabaseClient();
    const { data } = await supabase
        .from('documents')
        .select('*, clients(company_name, deleted_at), projects(name, deleted_at)')
        .eq('agency_id', agencyId)
        .eq('id', documentId)
        .is('deleted_at', null)
        .maybeSingle();
    if (!data) return null;
    const scope = await documentScope(agencyId, userId, role);
    if (scope.kind === 'filter') {
        if (!scope.clientIds.includes(data.client_id)) return null;
        if (scope.visibility === 'client' && data.visibility !== 'client') return null;
        if (scope.projectIds && data.project_id && !scope.projectIds.includes(data.project_id)) return null;
    }
    if (role === 'client') {
        const visible = await visibleProjectIds(agencyId, userId, role);
        if (data.project_id && visible.kind === 'ids' && !visible.ids.includes(data.project_id)) return null;
    }
    const client = Array.isArray(data.clients) ? data.clients[0] : data.clients;
    const project = Array.isArray(data.projects) ? data.projects[0] : data.projects;
    if (client?.deleted_at) return null;
    if (data.project_id && project?.deleted_at) return null;
    return {
        id: data.id,
        agency_id: data.agency_id,
        client_id: data.client_id,
        project_id: data.project_id,
        name: data.name,
        description: data.description,
        category: data.category,
        visibility: data.visibility,
        current_version: data.current_version,
        uploaded_by: data.uploaded_by,
        uploaded_by_kind: data.uploaded_by_kind,
        file_url: data.file_url,
        created_at: data.created_at,
        updated_at: data.updated_at,
        deleted_at: data.deleted_at,
        client_name: client?.company_name ?? 'Client',
        project_name: project?.name ?? null,
        client_deleted_at: client?.deleted_at ?? null,
    };
}

export function canShare(permissions: readonly string[]) {
    return permissions.includes('documents.share');
}

export function canEditDocument(input: {
    role: string;
    userId: string;
    document: { uploaded_by: string | null; uploaded_by_kind: string };
    permissions: readonly string[];
}): boolean {
    if (input.role === 'admin' || input.role === 'manager') {
        return input.permissions.includes('documents.upload');
    }
    if (input.role === 'creator') {
        return input.permissions.includes('documents.upload') && input.document.uploaded_by === input.userId;
    }
    if (input.role === 'client') {
        return (
            input.permissions.includes('documents.client_upload') &&
            input.document.uploaded_by_kind === 'client' &&
            input.document.uploaded_by === input.userId
        );
    }
    return false;
}

export function canDeleteDocument(input: {
    role: string;
    userId: string;
    document: { uploaded_by: string | null; uploaded_by_kind: string };
    permissions: readonly string[];
}): boolean {
    if (input.permissions.includes('documents.delete') && (input.role === 'admin' || input.role === 'manager')) return true;
    if (input.role === 'client') {
        return (
            input.permissions.includes('documents.client_upload') &&
            input.document.uploaded_by_kind === 'client' &&
            input.document.uploaded_by === input.userId
        );
    }
    return false;
}

export function applyDocumentScope<Q extends { in: (col: string, vals: string[]) => Q; eq: (col: string, val: string) => Q; is: (col: string, val: null) => Q; or: (filter: string) => Q }>(
    query: Q,
    scope: DocumentScope
): Q {
    if (scope.kind === 'all') return query;
    let next = query.in('client_id', scope.clientIds);
    if (scope.visibility) next = next.eq('visibility', scope.visibility);
    if (scope.projectIds) {
        // Unlinked docs OR docs on member projects.
        const ids = scope.projectIds.join(',');
        next = next.or(`project_id.is.null,project_id.in.(${ids})`);
    }
    return next;
}
