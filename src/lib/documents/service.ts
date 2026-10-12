import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getRoleGrants, permissionsForRole } from '@/lib/access/roles';
import { logActivity } from '@/lib/agency/activity';
import { projectInScope } from '@/lib/projects/access';
import type { DocumentCategory, DocumentVisibility } from '@/lib/types/database';
import {
    applyDocumentScope,
    canDeleteDocument,
    canEditDocument,
    canShare,
    documentInScope,
    documentScope,
    type ScopedDocument,
} from './access';
import { confirmUploads, createUploadSlots, removeFiles, signedDownloadUrl, type UploadIntent } from './storage';
import { notify } from '@/lib/notifications/service';

type Gate = { agencyId: string; userId: string; role: string };

const CATEGORIES = new Set<DocumentCategory>(['contract', 'brief', 'brand', 'report', 'notes', 'asset', 'other', 'from_client']);

async function permissions(role: string) {
    return permissionsForRole(await getRoleGrants(), role);
}

function mapDocumentError(error: { message: string; code?: string } | null) {
    if (!error) return null;
    if (error.message.includes('DOCUMENT_CLIENT_LOCKED')) {
        return NextResponse.json({ error: 'The client on a document cannot change.', code: 'BAD_REQUEST' }, { status: 400 });
    }
    if (error.message.includes('PROJECT_NOT_IN_CLIENT')) {
        return NextResponse.json({ error: 'That project does not belong to this client.', code: 'BAD_REQUEST' }, { status: 400 });
    }
    if (error.message.includes('documents_client_visibility_check') || error.message.includes('documents_visibility_check')) {
        return NextResponse.json({ error: 'Client uploads must stay shared with the portal.', code: 'BAD_REQUEST' }, { status: 400 });
    }
    return null;
}

function parseCategory(value: unknown): DocumentCategory | null {
    return typeof value === 'string' && CATEGORIES.has(value as DocumentCategory) ? (value as DocumentCategory) : null;
}

function parseVisibility(value: unknown): DocumentVisibility | null {
    return value === 'internal' || value === 'client' ? value : null;
}

function publicFile(file: { id: string; file_name: string; mime_type: string | null; size_bytes: number; status: string; version: number }) {
    return { id: file.id, file_name: file.file_name, mime_type: file.mime_type, size_bytes: file.size_bytes, status: file.status, version: file.version };
}

function isInlineMime(mime: string | null, fileName: string | null) {
    if (!mime || !fileName) return false;
    const lower = fileName.toLowerCase();
    if (mime === 'application/pdf' && lower.endsWith('.pdf')) return true;
    if (mime === 'image/png' && lower.endsWith('.png')) return true;
    if (mime === 'image/jpeg' && (lower.endsWith('.jpg') || lower.endsWith('.jpeg'))) return true;
    if (mime === 'image/gif' && lower.endsWith('.gif')) return true;
    if (mime === 'image/webp' && lower.endsWith('.webp')) return true;
    return false;
}

export async function listDocuments(
    gate: Gate,
    filters: { client?: string | null; project?: string | null; category?: string | null; visibility?: string | null; q?: string | null; sort?: string | null }
) {
    const supabase = createServerSupabaseClient();
    const scope = await documentScope(gate.agencyId, gate.userId, gate.role);
    let query = supabase
        .from('documents')
        .select('id, name, description, category, visibility, current_version, project_id, client_id, uploaded_by, uploaded_by_kind, updated_at, created_at, clients(company_name, deleted_at), projects(name, deleted_at)')
        .eq('agency_id', gate.agencyId)
        .is('deleted_at', null);
    query = applyDocumentScope(query, scope);
    if (filters.client) query = query.eq('client_id', filters.client);
    if (filters.project) query = query.eq('project_id', filters.project);
    if (filters.category) query = query.eq('category', filters.category);
    if (filters.visibility) query = query.eq('visibility', filters.visibility);
    if (filters.q) query = query.ilike('name', `%${filters.q.replace(/[%_]/g, '')}%`);
    query = filters.sort === 'name' ? query.order('name', { ascending: true }) : query.order('updated_at', { ascending: false });
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = (data ?? []).filter((row) => {
        const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
        const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;
        if (client?.deleted_at) return false;
        if (row.project_id && project?.deleted_at) return false;
        return true;
    });
    const ids = rows.map((row) => row.id);
    const { data: files } = ids.length
        ? await supabase.from('document_files').select('document_id, version, file_name, size_bytes, mime_type, status').in('document_id', ids).eq('status', 'ready')
        : { data: [] as { document_id: string; version: number; file_name: string; size_bytes: number; mime_type: string | null; status: string }[] };
    // A document whose first upload never finished has no ready file yet: don't list it.
    const withFile = rows.filter((row) => (files ?? []).some((file) => file.document_id === row.id && file.version === row.current_version));
    return withFile.map((row) => {
        const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
        const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;
        const current = (files ?? []).find((file) => file.document_id === row.id && file.version === row.current_version);
        return {
            id: row.id,
            name: row.name,
            description: row.description,
            category: row.category,
            visibility: row.visibility,
            current_version: row.current_version,
            project_id: row.project_id,
            project_name: project?.name ?? null,
            client_id: row.client_id,
            client_name: client?.company_name ?? 'Client',
            uploaded_by: row.uploaded_by,
            uploaded_by_kind: row.uploaded_by_kind,
            updated_at: row.updated_at,
            created_at: row.created_at,
            file_name: current?.file_name ?? null,
            size_bytes: current?.size_bytes ?? 0,
            mime_type: current?.mime_type ?? null,
        };
    });
}

export async function documentDetail(gate: Gate, id: string) {
    const row = await documentInScope(gate.agencyId, gate.userId, gate.role, id);
    if (!row) return null;
    const grants = await permissions(gate.role);
    const supabase = createServerSupabaseClient();
    const { data: files } = await supabase
        .from('document_files')
        .select('id, version, file_name, mime_type, size_bytes, status, uploaded_by, created_at')
        .eq('document_id', id)
        .eq('status', 'ready')
        .order('version', { ascending: false });
    const { data: activity } = await supabase
        .from('agency_activity_logs')
        .select('id, action, actor_id, target, created_at, metadata')
        .eq('agency_id', gate.agencyId)
        .contains('metadata', { document_id: id })
        .order('created_at', { ascending: false })
        .limit(40);
    return {
        document: {
            id: row.id,
            name: row.name,
            description: row.description,
            category: row.category,
            visibility: row.visibility,
            current_version: row.current_version,
            project_id: row.project_id,
            project_name: row.project_name,
            client_id: row.client_id,
            client_name: row.client_name,
            uploaded_by: row.uploaded_by,
            uploaded_by_kind: row.uploaded_by_kind,
            updated_at: row.updated_at,
            created_at: row.created_at,
        },
        files: (files ?? []).map(publicFile),
        activity: activity ?? [],
        can_edit: canEditDocument({ role: gate.role, userId: gate.userId, document: row, permissions: grants }),
        can_delete: canDeleteDocument({ role: gate.role, userId: gate.userId, document: row, permissions: grants }),
        can_share: canShare(grants),
    };
}

export async function createDocument(gate: Gate, body: Record<string, unknown>, file: UploadIntent) {
    const grants = await permissions(gate.role);
    if (!grants.includes('documents.upload')) {
        return NextResponse.json({ error: 'You cannot upload documents.', code: 'FORBIDDEN' }, { status: 403 });
    }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 200) return NextResponse.json({ error: 'Name must be 1 to 200 characters.', code: 'BAD_REQUEST' }, { status: 400 });
    const clientId = typeof body.client_id === 'string' ? body.client_id : '';
    if (!clientId) return NextResponse.json({ error: 'Choose a client.', code: 'BAD_REQUEST' }, { status: 400 });
    const category = parseCategory(body.category) ?? 'other';
    const visibility = parseVisibility(body.visibility) ?? 'internal';
    if (visibility === 'client' && !canShare(grants)) {
        return NextResponse.json({ error: 'You cannot share documents with clients.', code: 'FORBIDDEN' }, { status: 403 });
    }
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 2000) || null : null;
    const projectId = typeof body.project_id === 'string' && body.project_id ? body.project_id : null;
    if (projectId) {
        const project = await projectInScope(gate.agencyId, gate.userId, gate.role, projectId);
        if (!project || project.client_id !== clientId) {
            return NextResponse.json({ error: 'That project does not belong to this client.', code: 'BAD_REQUEST' }, { status: 400 });
        }
    }
    const scope = await documentScope(gate.agencyId, gate.userId, gate.role);
    if (scope.kind === 'filter' && !scope.clientIds.includes(clientId)) {
        return NextResponse.json({ error: 'Client not found.', code: 'NOT_FOUND' }, { status: 404 });
    }
    const supabase = createServerSupabaseClient();
    const { data: client } = await supabase.from('clients').select('id, deleted_at, status').eq('agency_id', gate.agencyId).eq('id', clientId).maybeSingle();
    if (!client || client.deleted_at) return NextResponse.json({ error: 'Client not found.', code: 'NOT_FOUND' }, { status: 404 });

    const { data, error } = await supabase
        .from('documents')
        .insert({
            agency_id: gate.agencyId,
            client_id: clientId,
            project_id: projectId,
            name,
            description,
            category,
            visibility,
            current_version: 1,
            uploaded_by: gate.userId,
            uploaded_by_kind: 'staff',
            file_url: null,
        })
        .select('id, name, visibility, current_version')
        .single();
    const mapped = mapDocumentError(error);
    if (mapped) return mapped;
    if (error || !data) throw new Error(error?.message ?? 'Create failed');

    const slots = await createUploadSlots(gate.agencyId, data.id, 1, gate.userId, [file]);
    if ('limit' in slots && slots.limit) {
        await supabase.from('documents').delete().eq('id', data.id);
        return slots.limit;
    }
    if ('error' in slots && slots.error) {
        await supabase.from('documents').delete().eq('id', data.id);
        return NextResponse.json({ error: slots.error, code: 'BAD_REQUEST' }, { status: 400 });
    }
    await logActivity({
        agencyId: gate.agencyId,
        actorId: gate.userId,
        action: visibility === 'client' ? 'documents.share' : 'documents.upload',
        target: name,
        metadata: { document_id: data.id, client_id: clientId, project_id: projectId },
    });
    return NextResponse.json({ document: data, uploads: slots.slots }, { status: 201 });
}

async function editable(gate: Gate, row: ScopedDocument) {
    const grants = await permissions(gate.role);
    return canEditDocument({ role: gate.role, userId: gate.userId, document: row, permissions: grants });
}

export async function updateDocument(gate: Gate, id: string, body: Record<string, unknown>) {
    const row = await documentInScope(gate.agencyId, gate.userId, gate.role, id);
    if (!row) return NextResponse.json({ error: 'Document not found.', code: 'NOT_FOUND' }, { status: 404 });
    if (!(await editable(gate, row))) return NextResponse.json({ error: 'You cannot edit this document.', code: 'FORBIDDEN' }, { status: 403 });
    const grants = await permissions(gate.role);
    const update: Record<string, unknown> = {};
    if (typeof body.name === 'string') {
        const name = body.name.trim();
        if (!name || name.length > 200) return NextResponse.json({ error: 'Name must be 1 to 200 characters.', code: 'BAD_REQUEST' }, { status: 400 });
        update.name = name;
    }
    if ('description' in body) {
        update.description = typeof body.description === 'string' ? body.description.trim().slice(0, 2000) || null : null;
    }
    if ('category' in body) {
        const category = parseCategory(body.category);
        if (!category) return NextResponse.json({ error: 'Unknown category.', code: 'BAD_REQUEST' }, { status: 400 });
        update.category = category;
    }
    if ('project_id' in body) {
        const projectId = typeof body.project_id === 'string' && body.project_id ? body.project_id : null;
        if (projectId) {
            const project = await projectInScope(gate.agencyId, gate.userId, gate.role, projectId);
            if (!project || project.client_id !== row.client_id) {
                return NextResponse.json({ error: 'That project does not belong to this client.', code: 'BAD_REQUEST' }, { status: 400 });
            }
        }
        update.project_id = projectId;
    }
    let shareAction: 'documents.share' | 'documents.unshare' | null = null;
    if ('visibility' in body) {
        const visibility = parseVisibility(body.visibility);
        if (!visibility) return NextResponse.json({ error: 'Unknown visibility.', code: 'BAD_REQUEST' }, { status: 400 });
        if (visibility !== row.visibility) {
            if (!canShare(grants)) return NextResponse.json({ error: 'You cannot share documents with clients.', code: 'FORBIDDEN' }, { status: 403 });
            if (row.uploaded_by_kind === 'client' && visibility !== 'client') {
                return NextResponse.json({ error: 'Client uploads must stay shared with the portal.', code: 'BAD_REQUEST' }, { status: 400 });
            }
            update.visibility = visibility;
            shareAction = visibility === 'client' ? 'documents.share' : 'documents.unshare';
        }
    }
    if (!Object.keys(update).length) return NextResponse.json({ error: 'Nothing to update.', code: 'BAD_REQUEST' }, { status: 400 });
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase.from('documents').update(update).eq('id', id).select('id, name, description, category, visibility, project_id').single();
    const mapped = mapDocumentError(error);
    if (mapped) return mapped;
    if (error) throw new Error(error.message);
    await logActivity({
        agencyId: gate.agencyId,
        actorId: gate.userId,
        action: shareAction ?? 'documents.update',
        target: data.name,
        metadata: { document_id: id },
    });
    if (shareAction === 'documents.share') {
        const supabaseNotify = createServerSupabaseClient();
        const { data: contacts } = await supabaseNotify
            .from('client_contacts')
            .select('user_id')
            .eq('client_id', row.client_id)
            .eq('portal_status', 'active');
        await notify({
            agencyId: gate.agencyId,
            kind: 'document.shared',
            actorId: gate.userId,
            entity: { type: 'document', id },
            recipients: (contacts ?? []).map((c) => c.user_id).filter((uid): uid is string => !!uid),
            vars: { entityTitle: data.name, entityId: id },
        });
    }
    return NextResponse.json({ document: data });
}

export async function deleteDocument(gate: Gate, id: string, confirmName: string) {
    const row = await documentInScope(gate.agencyId, gate.userId, gate.role, id);
    if (!row) return NextResponse.json({ error: 'Document not found.', code: 'NOT_FOUND' }, { status: 404 });
    const grants = await permissions(gate.role);
    if (!canDeleteDocument({ role: gate.role, userId: gate.userId, document: row, permissions: grants })) {
        return NextResponse.json({ error: 'You cannot delete this document.', code: 'FORBIDDEN' }, { status: 403 });
    }
    if (confirmName.trim() !== row.name) {
        return NextResponse.json({ error: 'Type the document name to confirm.', code: 'BAD_REQUEST' }, { status: 400 });
    }
    const supabase = createServerSupabaseClient();
    const { data: files } = await supabase.from('document_files').select('id, storage_path, size_bytes, status').eq('document_id', id);
    await removeFiles(gate.agencyId, files ?? []);
    const { error } = await supabase.from('documents').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
    await logActivity({ agencyId: gate.agencyId, actorId: gate.userId, action: 'documents.delete', target: row.name, metadata: { document_id: id } });
    return NextResponse.json({ ok: true });
}

async function hasReadyFile(documentId: string) {
    const supabase = createServerSupabaseClient();
    const { count } = await supabase.from('document_files').select('id', { count: 'exact', head: true }).eq('document_id', documentId).eq('status', 'ready');
    return (count ?? 0) > 0;
}

export async function replaceDocumentFile(gate: Gate, id: string, file: UploadIntent, opts: { retryFirst?: boolean } = {}) {
    const row = await documentInScope(gate.agencyId, gate.userId, gate.role, id);
    if (!row) return NextResponse.json({ error: 'Document not found.', code: 'NOT_FOUND' }, { status: 404 });
    if (!(await editable(gate, row))) return NextResponse.json({ error: 'You cannot edit this document.', code: 'FORBIDDEN' }, { status: 403 });
    // Retry of a first upload reuses version 1 of a document that still has no file.
    if (opts.retryFirst && (row.current_version !== 1 || (await hasReadyFile(id)))) {
        return NextResponse.json({ error: 'This document already has a file. Use Replace instead.', code: 'BAD_STATE' }, { status: 409 });
    }
    const next = opts.retryFirst ? 1 : row.current_version + 1;
    const slots = await createUploadSlots(gate.agencyId, id, next, gate.userId, [file]);
    if ('limit' in slots && slots.limit) return slots.limit;
    if ('error' in slots && slots.error) return NextResponse.json({ error: slots.error, code: 'BAD_REQUEST' }, { status: 400 });
    return NextResponse.json({ version: next, uploads: slots.slots });
}

export async function confirmDocumentUpload(gate: Gate, id: string, version: number, fileIds: string[]) {
    const row = await documentInScope(gate.agencyId, gate.userId, gate.role, id);
    if (!row) return NextResponse.json({ error: 'Document not found.', code: 'NOT_FOUND' }, { status: 404 });
    if (!(await editable(gate, row)) && gate.role !== 'client') {
        // Client confirm goes through portal service; staff must be editable.
        return NextResponse.json({ error: 'You cannot edit this document.', code: 'FORBIDDEN' }, { status: 403 });
    }
    const supabase = createServerSupabaseClient();
    const { data: owned } = await supabase
        .from('document_files')
        .select('id')
        .in('id', fileIds)
        .eq('document_id', id)
        .eq('version', version)
        .eq('agency_id', gate.agencyId);
    if ((owned ?? []).length !== fileIds.length) {
        return NextResponse.json({ error: 'One of those files was not found.', code: 'NOT_FOUND' }, { status: 404 });
    }
    const result = await confirmUploads(gate.agencyId, id, fileIds);
    if ('limit' in result && result.limit) {
        if (version === 1) await discardEmptyDocument(gate.agencyId, id);
        return result.limit;
    }
    if ('error' in result && result.error) {
        const unfinished = result.error === 'The upload has not finished yet.';
        if (version === 1 && !unfinished) await discardEmptyDocument(gate.agencyId, id);
        return NextResponse.json({ error: result.error, code: 'BAD_REQUEST' }, { status: 400 });
    }
    if (version > row.current_version) {
        await supabase.from('documents').update({ current_version: version }).eq('id', id);
        await logActivity({ agencyId: gate.agencyId, actorId: gate.userId, action: 'documents.version', target: row.name, metadata: { document_id: id, version } });
    }
    return NextResponse.json({ ok: true, version });
}

async function discardEmptyDocument(agencyId: string, id: string) {
    const supabase = createServerSupabaseClient();
    const { data: ready } = await supabase.from('document_files').select('id').eq('document_id', id).eq('status', 'ready').limit(1);
    if (ready?.length) return;
    const { data: pending } = await supabase.from('document_files').select('id, storage_path, size_bytes, status').eq('document_id', id);
    await removeFiles(agencyId, pending ?? []);
    await supabase.from('documents').delete().eq('id', id);
}

export async function downloadDocumentFile(gate: Gate, id: string, fileId: string, opts: { inline?: boolean } = {}) {
    const row = await documentInScope(gate.agencyId, gate.userId, gate.role, id);
    if (!row) return NextResponse.json({ error: 'Document not found.', code: 'NOT_FOUND' }, { status: 404 });
    const supabase = createServerSupabaseClient();
    const { data: file } = await supabase
        .from('document_files')
        .select('id, storage_path, file_name, mime_type, status')
        .eq('id', fileId)
        .eq('document_id', id)
        .eq('status', 'ready')
        .maybeSingle();
    if (!file) return NextResponse.json({ error: 'File not found.', code: 'NOT_FOUND' }, { status: 404 });
    const inline = opts.inline === true && isInlineMime(file.mime_type, file.file_name);
    const url = await signedDownloadUrl(file.storage_path, file.file_name, { inline });
    return NextResponse.redirect(url, 302);
}

/** Portal-facing list: shared only, current file, from_you flag. */
export async function listClientDocuments(agencyId: string, clientId: string, userId: string, filters: { project?: string | null } = {}) {
    const rows = await listSharedDocumentsForClient(agencyId, clientId, filters);
    return rows.map((row) => {
        const { uploaded_by: _u, uploaded_by_kind: kind, ...rest } = row;
        return {
            ...rest,
            from_you: kind === 'client' && _u === userId,
        };
    });
}

/** Shared documents for a client id (staff preview and portal). */
export async function listSharedDocumentsForClient(agencyId: string, clientId: string, filters: { project?: string | null } = {}) {
    const supabase = createServerSupabaseClient();
    let query = supabase
        .from('documents')
        .select('id, name, description, category, current_version, project_id, uploaded_by, uploaded_by_kind, updated_at, created_at, projects(name, deleted_at)')
        .eq('agency_id', agencyId)
        .eq('client_id', clientId)
        .eq('visibility', 'client')
        .is('deleted_at', null)
        .order('updated_at', { ascending: false });
    if (filters.project) query = query.eq('project_id', filters.project);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = (data ?? []).filter((row) => {
        const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;
        if (row.project_id && project?.deleted_at) return false;
        return true;
    });
    const ids = rows.map((row) => row.id);
    const { data: files } = ids.length
        ? await supabase.from('document_files').select('document_id, version, file_name, size_bytes, mime_type').in('document_id', ids).eq('status', 'ready')
        : { data: [] as { document_id: string; version: number; file_name: string; size_bytes: number; mime_type: string | null }[] };
    // Clients never see a document until its file has finished uploading.
    const withFile = rows.filter((row) => (files ?? []).some((file) => file.document_id === row.id && file.version === row.current_version));
    return withFile.map((row) => {
        const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;
        const current = (files ?? []).find((file) => file.document_id === row.id && file.version === row.current_version);
        return {
            id: row.id,
            name: row.name,
            description: row.description,
            category: row.category,
            project_id: row.project_id,
            project_name: project?.name ?? null,
            updated_at: row.updated_at,
            created_at: row.created_at,
            file_name: current?.file_name ?? null,
            size_bytes: current?.size_bytes ?? 0,
            mime_type: current?.mime_type ?? null,
            uploaded_by: row.uploaded_by as string | null,
            uploaded_by_kind: row.uploaded_by_kind as string,
        };
    });
}

export async function clientDocumentDetail(agencyId: string, clientId: string, userId: string, id: string) {
    const row = await documentInScope(agencyId, userId, 'client', id);
    if (!row || row.client_id !== clientId || row.visibility !== 'client') return null;
    const supabase = createServerSupabaseClient();
    const { data: file } = await supabase
        .from('document_files')
        .select('id, version, file_name, mime_type, size_bytes, status')
        .eq('document_id', id)
        .eq('version', row.current_version)
        .eq('status', 'ready')
        .maybeSingle();
    if (!file) return null;
    return {
        document: {
            id: row.id,
            name: row.name,
            description: row.description,
            category: row.category,
            project_id: row.project_id,
            project_name: row.project_name,
            updated_at: row.updated_at,
            from_you: row.uploaded_by_kind === 'client' && row.uploaded_by === userId,
        },
        file: publicFile(file),
    };
}

export async function createClientDocument(
    gate: Gate & { clientId: string; agencyName: string; agencySlug: string; logoUrl: string | null; brandColor: string | null; clientName: string; ownerId: string | null; readOnly: boolean },
    body: Record<string, unknown>,
    file: UploadIntent
) {
    if (gate.readOnly) {
        return NextResponse.json({ error: 'Uploads are paused while the workspace is read-only.', code: 'READ_ONLY' }, { status: 403 });
    }
    const grants = await permissions('client');
    if (!grants.includes('documents.client_upload')) {
        return NextResponse.json({ error: 'You cannot upload files.', code: 'FORBIDDEN' }, { status: 403 });
    }
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : file.name;
    if (!name || name.length > 200) return NextResponse.json({ error: 'Name must be 1 to 200 characters.', code: 'BAD_REQUEST' }, { status: 400 });
    const projectId = typeof body.project_id === 'string' && body.project_id ? body.project_id : null;
    if (projectId) {
        const project = await projectInScope(gate.agencyId, gate.userId, 'client', projectId);
        if (!project || project.client_id !== gate.clientId) {
            return NextResponse.json({ error: 'Project not found.', code: 'NOT_FOUND' }, { status: 404 });
        }
    }
    const supabase = createServerSupabaseClient();

    // Retry: a new upload link for the client's own document that still has no file.
    const retryId = typeof body.retry_document_id === 'string' && body.retry_document_id ? body.retry_document_id : null;
    if (retryId) {
        const { data: existing } = await supabase
            .from('documents')
            .select('id, name, current_version')
            .eq('id', retryId)
            .eq('agency_id', gate.agencyId)
            .eq('client_id', gate.clientId)
            .eq('uploaded_by', gate.userId)
            .eq('uploaded_by_kind', 'client')
            .is('deleted_at', null)
            .maybeSingle();
        if (!existing || existing.current_version !== 1 || (await hasReadyFile(retryId))) {
            return NextResponse.json({ error: 'Not found.', code: 'NOT_FOUND' }, { status: 404 });
        }
        const retrySlots = await createUploadSlots(gate.agencyId, retryId, 1, gate.userId, [file]);
        if ('limit' in retrySlots && retrySlots.limit) {
            return NextResponse.json({ error: `${gate.agencyName} storage is full. Please let them know.`, code: 'LIMIT' }, { status: 403 });
        }
        if ('error' in retrySlots && retrySlots.error) return NextResponse.json({ error: retrySlots.error, code: 'BAD_REQUEST' }, { status: 400 });
        return NextResponse.json({ document: { id: existing.id, name: existing.name }, uploads: retrySlots.slots });
    }

    const { data, error } = await supabase
        .from('documents')
        .insert({
            agency_id: gate.agencyId,
            client_id: gate.clientId,
            project_id: projectId,
            name,
            description: null,
            category: 'from_client',
            visibility: 'client',
            current_version: 1,
            uploaded_by: gate.userId,
            uploaded_by_kind: 'client',
            file_url: null,
        })
        .select('id, name')
        .single();
    const mapped = mapDocumentError(error);
    if (mapped) return mapped;
    if (error || !data) throw new Error(error?.message ?? 'Create failed');

    const slots = await createUploadSlots(gate.agencyId, data.id, 1, gate.userId, [file]);
    if ('limit' in slots && slots.limit) {
        await supabase.from('documents').delete().eq('id', data.id);
        return NextResponse.json({ error: `${gate.agencyName} storage is full. Please let them know.`, code: 'LIMIT' }, { status: 403 });
    }
    if ('error' in slots && slots.error) {
        await supabase.from('documents').delete().eq('id', data.id);
        return NextResponse.json({ error: slots.error, code: 'BAD_REQUEST' }, { status: 400 });
    }
    await logActivity({
        agencyId: gate.agencyId,
        actorId: gate.userId,
        action: 'documents.client_upload',
        target: name,
        metadata: { document_id: data.id, client_id: gate.clientId },
    });
    return NextResponse.json({ document: data, uploads: slots.slots }, { status: 201 });
}

export async function confirmClientDocumentUpload(
    gate: Gate & { clientId: string; agencyName: string; agencySlug: string; logoUrl: string | null; brandColor: string | null; clientName: string; ownerId: string | null },
    id: string,
    fileIds: string[]
) {
    const row = await documentInScope(gate.agencyId, gate.userId, 'client', id);
    if (!row || row.client_id !== gate.clientId) return NextResponse.json({ error: 'Document not found.', code: 'NOT_FOUND' }, { status: 404 });
    if (row.uploaded_by_kind !== 'client' || row.uploaded_by !== gate.userId) {
        // Same answer as a missing document: don't reveal someone else's upload exists.
        return NextResponse.json({ error: 'Document not found.', code: 'NOT_FOUND' }, { status: 404 });
    }
    const supabase = createServerSupabaseClient();
    const { data: owned } = await supabase
        .from('document_files')
        .select('id')
        .in('id', fileIds)
        .eq('document_id', id)
        .eq('version', 1)
        .eq('agency_id', gate.agencyId)
        .eq('uploaded_by', gate.userId);
    if ((owned ?? []).length !== fileIds.length) {
        return NextResponse.json({ error: 'One of those files was not found.', code: 'NOT_FOUND' }, { status: 404 });
    }
    const result = await confirmUploads(gate.agencyId, id, fileIds);
    if ('limit' in result && result.limit) {
        await discardEmptyDocument(gate.agencyId, id);
        return NextResponse.json({ error: `${gate.agencyName} storage is full. Please let them know.`, code: 'LIMIT' }, { status: 403 });
    }
    if ('error' in result && result.error) {
        const unfinished = result.error === 'The upload has not finished yet.';
        if (!unfinished) await discardEmptyDocument(gate.agencyId, id);
        return NextResponse.json({ error: result.error, code: 'BAD_REQUEST' }, { status: 400 });
    }
    const settled = 'settled' in result ? result.settled ?? [] : [];
    if (settled.length > 0) {
        const staffId = gate.ownerId;
        let recipients: string[] = [];
        if (staffId) recipients = [staffId];
        else {
            const { data: admins } = await supabase
                .from('agency_members')
                .select('user_id')
                .eq('agency_id', gate.agencyId)
                .eq('role', 'admin')
                .eq('status', 'active')
                .limit(1);
            recipients = (admins ?? []).map((a) => a.user_id);
        }
        await notify({
            agencyId: gate.agencyId,
            kind: 'document.client_upload',
            actorId: gate.userId,
            entity: { type: 'document', id },
            recipients,
            vars: { clientName: gate.clientName, entityTitle: row.name, entityId: id },
        });
    }
    return NextResponse.json({ ok: true });
}

export async function updateClientDocument(gate: Gate & { clientId: string }, id: string, body: Record<string, unknown>) {
    const row = await documentInScope(gate.agencyId, gate.userId, 'client', id);
    if (!row || row.client_id !== gate.clientId) return NextResponse.json({ error: 'Document not found.', code: 'NOT_FOUND' }, { status: 404 });
    const grants = await permissions('client');
    if (!canEditDocument({ role: 'client', userId: gate.userId, document: row, permissions: grants })) {
        return NextResponse.json({ error: 'You can only rename your own uploads.', code: 'FORBIDDEN' }, { status: 403 });
    }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 200) return NextResponse.json({ error: 'Name must be 1 to 200 characters.', code: 'BAD_REQUEST' }, { status: 400 });
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase.from('documents').update({ name }).eq('id', id).select('id, name').single();
    if (error) throw new Error(error.message);
    await logActivity({ agencyId: gate.agencyId, actorId: gate.userId, action: 'documents.update', target: name, metadata: { document_id: id } });
    return NextResponse.json({ document: data });
}

export async function deleteClientDocument(gate: Gate & { clientId: string }, id: string) {
    const row = await documentInScope(gate.agencyId, gate.userId, 'client', id);
    if (!row || row.client_id !== gate.clientId) return NextResponse.json({ error: 'Document not found.', code: 'NOT_FOUND' }, { status: 404 });
    const grants = await permissions('client');
    if (!canDeleteDocument({ role: 'client', userId: gate.userId, document: row, permissions: grants })) {
        return NextResponse.json({ error: 'You can only delete your own uploads.', code: 'FORBIDDEN' }, { status: 403 });
    }
    const supabase = createServerSupabaseClient();
    const { data: files } = await supabase.from('document_files').select('id, storage_path, size_bytes, status').eq('document_id', id);
    await removeFiles(gate.agencyId, files ?? []);
    const { error } = await supabase.from('documents').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
    await logActivity({ agencyId: gate.agencyId, actorId: gate.userId, action: 'documents.delete', target: row.name, metadata: { document_id: id } });
    return NextResponse.json({ ok: true });
}

export async function downloadClientDocument(agencyId: string, clientId: string, userId: string, id: string, opts: { inline?: boolean } = {}) {
    const row = await documentInScope(agencyId, userId, 'client', id);
    if (!row || row.client_id !== clientId || row.visibility !== 'client') {
        return NextResponse.json({ error: 'Document not found.', code: 'NOT_FOUND' }, { status: 404 });
    }
    const supabase = createServerSupabaseClient();
    const { data: file } = await supabase
        .from('document_files')
        .select('id, storage_path, file_name, mime_type, status')
        .eq('document_id', id)
        .eq('version', row.current_version)
        .eq('status', 'ready')
        .maybeSingle();
    if (!file) return NextResponse.json({ error: 'File not found.', code: 'NOT_FOUND' }, { status: 404 });
    const inline = opts.inline === true && isInlineMime(file.mime_type, file.file_name);
    const url = await signedDownloadUrl(file.storage_path, file.file_name, { inline });
    return NextResponse.redirect(url, 302);
}

export async function latestClientUploads(agencyId: string, limit = 5) {
    const supabase = createServerSupabaseClient();
    const { data } = await supabase
        .from('documents')
        .select('id, name, created_at, clients(company_name, deleted_at)')
        .eq('agency_id', agencyId)
        .eq('uploaded_by_kind', 'client')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(limit * 2);
    return (data ?? [])
        .filter((row) => {
            const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
            return !client?.deleted_at;
        })
        .slice(0, limit)
        .map((row) => {
            const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
            return { id: row.id, name: row.name, created_at: row.created_at, client_name: client?.company_name ?? 'Client' };
        });
}
