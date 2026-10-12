import {
    cleanupPending as engineCleanup,
    confirmUploads as engineConfirm,
    createUploadSlots as engineSlots,
    removeFiles as engineRemove,
    signedFileUrl,
    type FileTarget,
    type UploadIntent,
    type UploadSlot,
} from '@/lib/files/engine';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export type { UploadIntent, UploadSlot };

const TARGET_BASE = { bucket: 'documents' as const, table: 'document_files' as const };

function versionTarget(documentId: string, version: number): FileTarget {
    return {
        ...TARGET_BASE,
        pathPrefix: `documents/${documentId}/${version}`,
        owner: { document_id: documentId, version },
        existingFilter: { document_id: documentId, version: String(version) },
    };
}

export async function cleanupPending(limit = 50) {
    return engineCleanup(TARGET_BASE, limit);
}

export async function createUploadSlots(agencyId: string, documentId: string, version: number, userId: string, files: UploadIntent[]) {
    // Documents allow one file per version; clear any recent pending slot for this version first.
    const supabase = createServerSupabaseClient();
    const { data: pending } = await supabase
        .from('document_files')
        .select('id, storage_path, size_bytes, status')
        .eq('document_id', documentId)
        .eq('version', version)
        .eq('status', 'pending');
    if (pending?.length) await removeFiles(agencyId, pending);
    if (files.length !== 1) return { error: 'Upload one file at a time.' as const };
    return engineSlots(agencyId, versionTarget(documentId, version), userId, files);
}

export async function confirmUploads(agencyId: string, documentId: string, fileIds: string[]) {
    return engineConfirm(agencyId, TARGET_BASE, fileIds, { column: 'document_id', value: documentId });
}

export async function signedDownloadUrl(path: string, fileName: string, opts: { inline?: boolean } = {}) {
    return signedFileUrl('documents', path, fileName, opts);
}

export async function removeFiles(agencyId: string, files: { id: string; storage_path: string; size_bytes: number; status: string }[]) {
    return engineRemove(agencyId, TARGET_BASE, files);
}
