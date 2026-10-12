import { randomUUID } from 'crypto';
import { checkLimit, limitExceededResponse } from '@/lib/access/entitlements';
import { getUsage } from '@/lib/portal/usage';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { FILE_LIMITS, validateFileIntent } from './rules';

const MB = 1024 * 1024;
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type FileBucket = 'deliverables' | 'documents';
export type FileTable = 'deliverable_files' | 'document_files';

export interface FileTarget {
    bucket: FileBucket;
    table: FileTable;
    /** Path after agencies/<agencyId>/, e.g. deliverables/<id>/<version> or documents/<id>/<version> */
    pathPrefix: string;
    /** Extra columns written on insert (owner foreign keys). */
    owner: Record<string, string | number | null>;
    /** Optional: count existing files for this owner group (e.g. version). */
    existingFilter?: Record<string, string>;
}

export interface UploadIntent {
    name: string;
    size: number;
    type?: string | null;
}

export interface UploadSlot {
    file_id: string;
    upload_url: string;
    token: string;
    path: string;
}

export type OwnerFilter = { column: string; value: string | number };

export function pendingCutoffIso(now = Date.now()) {
    return new Date(now - PENDING_MAX_AGE_MS).toISOString();
}

async function adjustUsage(agencyId: string, bytes: number) {
    if (!bytes) return;
    const supabase = createServerSupabaseClient();
    const { error } = await supabase.rpc('increment_storage_usage', { p_agency_id: agencyId, p_bytes: bytes });
    if (error) throw new Error(error.message);
}

/** Pending bytes across both file tables, counting only rows still inside the 24h window. */
async function pendingBytesAcross(agencyId: string) {
    const supabase = createServerSupabaseClient();
    const cutoff = pendingCutoffIso();
    const [deliverables, documents] = await Promise.all([
        supabase.from('deliverable_files').select('size_bytes').eq('agency_id', agencyId).eq('status', 'pending').gte('created_at', cutoff),
        supabase.from('document_files').select('size_bytes').eq('agency_id', agencyId).eq('status', 'pending').gte('created_at', cutoff),
    ]);
    const sum = (rows: { size_bytes: number | null }[] | null) =>
        (rows ?? []).reduce((total, row) => total + Number(row.size_bytes || 0), 0);
    // document_files may not exist until migration 042; treat missing table as zero pending.
    const docs = documents.error ? [] : documents.data;
    return sum(deliverables.data) + sum(docs);
}

async function cleanupPendingTable(bucket: FileBucket, table: FileTable, limit: number) {
    const supabase = createServerSupabaseClient();
    const cutoff = pendingCutoffIso();
    // Only columns both file tables have (deliverable_files has no document_id).
    const { data, error } = await supabase.from(table).select('id, storage_path').eq('status', 'pending').lt('created_at', cutoff).limit(limit);
    if (error) {
        console.error(`[files] pending clean-up of ${table} failed:`, error.message);
        return [] as { id: string; storage_path: string }[];
    }
    const rows = data ?? [];
    if (!rows.length) return [];
    await supabase.storage.from(bucket).remove(rows.map((row) => row.storage_path));
    await supabase.from(table).delete().in('id', rows.map((row) => row.id));
    return rows;
}

async function cleanupEmptyDocuments(limit = 50) {
    const supabase = createServerSupabaseClient();
    // Documents older than 24h with no ready file (abandoned first uploads), oldest first.
    const { data: docs, error } = await supabase.rpc('empty_documents', { p_limit: limit });
    if (error) {
        console.error('[files] empty document clean-up failed:', error.message);
        return;
    }
    if (!docs?.length) return;

    for (const doc of docs as { id: string; agency_id: string }[]) {
        // Re-check first: a file may have been confirmed since the scan.
        const { count: ready } = await supabase.from('document_files').select('id', { count: 'exact', head: true }).eq('document_id', doc.id).eq('status', 'ready');
        if ((ready ?? 0) > 0) continue;
        const { data: leftovers } = await supabase
            .from('document_files')
            .select('id, storage_path')
            .eq('document_id', doc.id)
            .eq('status', 'pending');
        if (leftovers?.length) {
            await supabase.storage.from('documents').remove(leftovers.map((row) => row.storage_path));
            await supabase.from('document_files').delete().in('id', leftovers.map((row) => row.id));
        }
        // Remove any leftover objects under the document folder.
        const folder = `agencies/${doc.agency_id}/documents/${doc.id}`;
        const listed = await supabase.storage.from('documents').list(folder, { limit: 100 });
        if (listed.data?.length) {
            const paths: string[] = [];
            for (const entry of listed.data) {
                if (entry.id) paths.push(`${folder}/${entry.name}`);
                else {
                    const nested = await supabase.storage.from('documents').list(`${folder}/${entry.name}`, { limit: 100 });
                    for (const child of nested.data ?? []) paths.push(`${folder}/${entry.name}/${child.name}`);
                }
            }
            if (paths.length) await supabase.storage.from('documents').remove(paths);
        }
        await supabase.from('documents').delete().eq('id', doc.id);
    }
}

/**
 * Always cleans both file tables (regardless of which target called it), then empty documents.
 * Storage objects are removed before rows.
 */
export async function cleanupPending(_target?: Pick<FileTarget, 'bucket' | 'table'>, limit = 50) {
    await cleanupPendingTable('deliverables', 'deliverable_files', limit);
    await cleanupPendingTable('documents', 'document_files', limit);
    await cleanupEmptyDocuments(limit);
}

export async function createUploadSlots(agencyId: string, target: FileTarget, userId: string, files: UploadIntent[]) {
    await cleanupPending(target);
    const supabase = createServerSupabaseClient();
    let existing = 0;
    if (target.existingFilter) {
        // Only finished files count toward the per-version limit; a failed or retried upload's
        // pending row would otherwise use up a slot until clean-up.
        let query = supabase.from(target.table).select('id', { count: 'exact', head: true }).eq('status', 'ready');
        for (const [key, value] of Object.entries(target.existingFilter)) query = query.eq(key, value);
        const { count } = await query;
        existing = count ?? 0;
    }
    if (existing + files.length > FILE_LIMITS.maxFiles) {
        return { error: `A version can have at most ${FILE_LIMITS.maxFiles} files.` as const };
    }
    const parsed = [];
    for (let i = 0; i < files.length; i++) {
        const file = validateFileIntent({ name: files[i].name, size: files[i].size, type: files[i].type, existingCount: existing + i });
        if (!file.ok) return { error: file.error };
        parsed.push(file.value);
    }
    const usage = await getUsage(agencyId);
    const pendingBytes = await pendingBytesAcross(agencyId);
    const adding = Math.ceil((pendingBytes + parsed.reduce((sum, file) => sum + file.size, 0)) / MB);
    const seats = await checkLimit(agencyId, 'storageMB', usage.storageMB, adding || 1);
    if (!seats.allowed) return { limit: limitExceededResponse('storageMB', seats) };

    const slots: UploadSlot[] = [];
    for (const file of parsed) {
        const id = randomUUID();
        const path = `agencies/${agencyId}/${target.pathPrefix}/${id}`;
        const { error: insertError } = await supabase.from(target.table).insert({
            id,
            agency_id: agencyId,
            storage_path: path,
            file_name: file.name,
            mime_type: file.type,
            size_bytes: file.size,
            status: 'pending',
            uploaded_by: userId,
            ...target.owner,
        });
        if (insertError) throw new Error(insertError.message);
        const signed = await supabase.storage.from(target.bucket).createSignedUploadUrl(path);
        if (signed.error || !signed.data) {
            await supabase.from(target.table).delete().eq('id', id);
            throw new Error(signed.error?.message ?? 'Could not start the upload.');
        }
        slots.push({ file_id: id, upload_url: signed.data.signedUrl, token: signed.data.token, path: signed.data.path });
    }
    return { slots };
}

/** Real size and content type of an uploaded object, as stored (not as the uploader declared). */
async function objectInfo(bucket: FileBucket, path: string): Promise<{ size: number; type: string | null } | null> {
    const supabase = createServerSupabaseClient();
    const folder = path.slice(0, path.lastIndexOf('/'));
    const name = path.slice(path.lastIndexOf('/') + 1);
    type Info = { size?: number; contentType?: string; content_type?: string };
    const storage = supabase.storage.from(bucket) as {
        info?: (p: string) => Promise<{ data: Info | null; error: { message: string } | null }>;
    };
    if (typeof storage.info === 'function') {
        const info = await storage.info(path);
        if (info.data && typeof info.data.size === 'number') {
            return { size: info.data.size, type: info.data.contentType ?? info.data.content_type ?? null };
        }
    }
    const listed = await supabase.storage.from(bucket).list(folder, { search: name, limit: 20 });
    const match = (listed.data ?? []).find((item) => item.name === name);
    const meta = (match?.metadata && typeof match.metadata === 'object' ? match.metadata : {}) as { size?: number; mimetype?: string };
    const size = Number(meta.size);
    return Number.isFinite(size) ? { size, type: meta.mimetype ?? null } : null;
}

/**
 * Marks uploaded files ready and counts their real size. Each file is settled on its own
 * so a failure part-way never leaves a ready file uncounted, and a second confirm can't double-count.
 * Optional owner filter refuses foreign ids.
 */
export async function confirmUploads(
    agencyId: string,
    target: Pick<FileTarget, 'bucket' | 'table'>,
    fileIds: string[],
    owner?: OwnerFilter
) {
    const supabase = createServerSupabaseClient();
    let query = supabase.from(target.table).select('id, storage_path, status, agency_id, size_bytes').in('id', fileIds).eq('agency_id', agencyId);
    if (owner) query = query.eq(owner.column, owner.value);
    const { data } = await query;
    const rows = data ?? [];
    if (rows.length !== fileIds.length) return { error: 'One of those files was not found.' };
    const settled: string[] = [];
    for (const row of rows) {
        if (row.status === 'ready') continue;
        const info = await objectInfo(target.bucket, row.storage_path);
        if (info == null) return { error: 'The upload has not finished yet.' };
        const size = info.size;
        const discard = async () => {
            await supabase.storage.from(target.bucket).remove([row.storage_path]);
            await supabase.from(target.table).delete().eq('id', row.id).eq('status', 'pending');
        };
        if (size > FILE_LIMITS.maxBytes || size < 1) {
            await discard();
            return { error: 'Each file must be between 1 byte and 50 MB.' };
        }
        const usage = await getUsage(agencyId);
        const check = await checkLimit(agencyId, 'storageMB', usage.storageMB, Math.max(1, Math.ceil(size / MB)));
        if (!check.allowed) {
            await discard();
            return { limit: limitExceededResponse('storageMB', check) };
        }
        const { data: flipped, error } = await supabase
            .from(target.table)
            // Store the real content type so previews never trust what the browser declared.
            .update({ status: 'ready', size_bytes: size, mime_type: info.type ? info.type.slice(0, 200) : null })
            .eq('id', row.id)
            .eq('status', 'pending')
            .select('id');
        if (error) throw new Error(error.message);
        if (flipped?.length) {
            await adjustUsage(agencyId, size);
            settled.push(row.id);
        }
    }
    return { ok: true as const, settled };
}

export async function signedFileUrl(bucket: FileBucket, path: string, fileName: string, opts: { inline?: boolean } = {}) {
    const supabase = createServerSupabaseClient();
    // storage-js encodes the whole URL; add the download name after signing (it isn't part of the signature).
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
    if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Could not prepare the download.');
    if (opts.inline) return data.signedUrl;
    return `${data.signedUrl}&download=${encodeURIComponent(fileName)}`;
}

export async function removeFiles(
    agencyId: string,
    target: Pick<FileTarget, 'bucket' | 'table'>,
    files: { id: string; storage_path: string; size_bytes: number; status: string }[]
) {
    if (!files.length) return;
    const supabase = createServerSupabaseClient();
    await supabase.storage.from(target.bucket).remove(files.map((file) => file.storage_path));
    await supabase.from(target.table).delete().in('id', files.map((file) => file.id));
    const ready = files.filter((file) => file.status === 'ready').reduce((sum, file) => sum + Number(file.size_bytes || 0), 0);
    await adjustUsage(agencyId, -ready);
}
