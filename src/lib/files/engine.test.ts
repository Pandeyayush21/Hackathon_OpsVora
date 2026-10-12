import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, fakeClient, type FakeDb } from '@/test/fake-supabase';

let db: FakeDb;
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: () => fakeClient(db) }));
vi.mock('@/lib/portal/usage', () => ({ getUsage: async () => ({ storageMB: 0 }) }));
vi.mock('@/lib/access/entitlements', () => ({
    checkLimit: async () => ({ allowed: true, limit: -1, used: 0 }),
    limitExceededResponse: () => null,
}));

const { cleanupPending, confirmUploads, pendingCutoffIso } = await import('./engine');

const OLD = '2020-01-01T00:00:00.000Z';
const NEW = new Date().toISOString();

describe('pendingCutoffIso', () => {
    it('is 24 hours before now', () => {
        const now = Date.parse('2026-10-02T12:00:00.000Z');
        expect(pendingCutoffIso(now)).toBe('2026-10-01T12:00:00.000Z');
    });
});

describe('cleanupPending', () => {
    beforeEach(() => {
        db = createFakeDb({
            deliverable_files: [
                { id: 'd-old', storage_path: 'x/d-old', status: 'pending', created_at: OLD },
                { id: 'd-new', storage_path: 'x/d-new', status: 'pending', created_at: NEW },
                { id: 'd-ready', storage_path: 'x/d-ready', status: 'ready', created_at: OLD },
            ],
            document_files: [{ id: 'f-old', document_id: 'doc-empty', storage_path: 'y/f-old', status: 'pending', created_at: OLD }],
            documents: [
                { id: 'doc-empty', agency_id: 'a1' },
                { id: 'doc-raced', agency_id: 'a1' },
            ],
        });
    });

    it('never asks deliverable_files for a column it does not have', async () => {
        await cleanupPending();
        const deliverableSelects = db.selects.filter((s) => s.table === 'deliverable_files');
        expect(deliverableSelects.length).toBeGreaterThan(0);
        for (const s of deliverableSelects) expect(s.columns).not.toContain('document_id');
    });

    it('removes only stale pending uploads, in both tables', async () => {
        await cleanupPending();
        expect(db.tables.deliverable_files.map((r) => r.id).sort()).toEqual(['d-new', 'd-ready']);
        expect(db.storageRemoved).toContain('x/d-old');
        expect(db.storageRemoved).not.toContain('x/d-new');
        expect(db.tables.document_files).toHaveLength(0);
    });

    it('deletes an empty document but keeps one that got a ready file meanwhile', async () => {
        db.rpcResult = (name) =>
            name === 'empty_documents'
                ? { data: [{ id: 'doc-empty', agency_id: 'a1' }, { id: 'doc-raced', agency_id: 'a1' }], error: null }
                : { data: null, error: null };
        db.tables.document_files.push({ id: 'f-ready', document_id: 'doc-raced', storage_path: 'y/f-ready', status: 'ready', created_at: NEW });
        await cleanupPending();
        expect(db.tables.documents.map((d) => d.id)).toEqual(['doc-raced']);
        expect(db.storageRemoved).not.toContain('y/f-ready');
    });
});

describe('confirmUploads owner filter', () => {
    beforeEach(() => {
        db = createFakeDb({
            document_files: [
                { id: 'mine', agency_id: 'a1', document_id: 'doc-1', storage_path: 'p/mine', status: 'pending', size_bytes: 1 },
                { id: 'theirs', agency_id: 'a1', document_id: 'doc-2', storage_path: 'p/theirs', status: 'pending', size_bytes: 1 },
            ],
        });
    });

    it("refuses a file that belongs to another document", async () => {
        const result = await confirmUploads('a1', { bucket: 'documents', table: 'document_files' }, ['theirs'], { column: 'document_id', value: 'doc-1' });
        expect(result).toEqual({ error: 'One of those files was not found.' });
        expect(db.tables.document_files.find((r) => r.id === 'theirs')?.status).toBe('pending');
    });

    it("refuses a file from another agency", async () => {
        const result = await confirmUploads('a2', { bucket: 'documents', table: 'document_files' }, ['mine'], { column: 'document_id', value: 'doc-1' });
        expect(result).toEqual({ error: 'One of those files was not found.' });
    });
});
