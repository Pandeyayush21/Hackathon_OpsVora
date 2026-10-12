import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, fakeClient, type FakeDb } from '@/test/fake-supabase';

let db: FakeDb;
const scopes = {
    client: { kind: 'clients', ids: ['c1'] } as { kind: 'all' } | { kind: 'clients'; ids: string[] },
    work: { kind: 'projects', ids: ['p1'] } as { kind: 'all' } | { kind: 'projects'; ids: string[] },
};

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: () => fakeClient(db) }));
vi.mock('@/lib/clients/scope', () => ({ clientScope: async () => scopes.client }));
vi.mock('@/lib/projects/scope', () => ({ workScope: async () => scopes.work }));

const { documentScope } = await import('./access');
const { listClientDocuments } = await import('./service');

const NONE = '00000000-0000-0000-0000-000000000000';

describe('documentScope', () => {
    beforeEach(() => {
        db = createFakeDb({
            projects: [
                { id: 'p1', agency_id: 'a1', client_id: 'c1', deleted_at: null },
                { id: 'p2', agency_id: 'a1', client_id: 'c2', deleted_at: null },
            ],
        });
        scopes.client = { kind: 'clients', ids: ['c1'] };
        scopes.work = { kind: 'projects', ids: ['p1'] };
    });

    it('gives admins and managers everything', async () => {
        expect(await documentScope('a1', 'u', 'admin')).toEqual({ kind: 'all' });
        expect(await documentScope('a1', 'u', 'manager')).toEqual({ kind: 'all' });
    });

    it('limits a creator to clients of their member projects, and those projects', async () => {
        expect(await documentScope('a1', 'u', 'creator')).toEqual({ kind: 'filter', clientIds: ['c1'], projectIds: ['p1'] });
    });

    it('gives a creator with no projects nothing', async () => {
        scopes.work = { kind: 'projects', ids: [] };
        expect(await documentScope('a1', 'u', 'creator')).toEqual({ kind: 'filter', clientIds: [NONE], projectIds: [NONE] });
    });

    it('limits a client to their own client and shared documents only', async () => {
        expect(await documentScope('a1', 'u', 'client')).toEqual({ kind: 'filter', clientIds: ['c1'], projectIds: null, visibility: 'client' });
        scopes.client = { kind: 'clients', ids: [] };
        expect(await documentScope('a1', 'u', 'client')).toMatchObject({ clientIds: [NONE], visibility: 'client' });
    });
});

describe('listClientDocuments (portal)', () => {
    const doc = (over: Record<string, unknown>) => ({
        agency_id: 'a1',
        client_id: 'c1',
        visibility: 'client',
        current_version: 1,
        project_id: null,
        projects: null,
        deleted_at: null,
        description: null,
        category: 'other',
        uploaded_by: 'staff-1',
        uploaded_by_kind: 'staff',
        updated_at: '2026-10-01',
        created_at: '2026-10-01',
        ...over,
    });

    beforeEach(() => {
        db = createFakeDb({
            documents: [
                doc({ id: 'shared', name: 'Brand guide' }),
                doc({ id: 'internal', name: 'Contract', visibility: 'internal' }),
                doc({ id: 'other-client', name: 'Other', client_id: 'c2' }),
                doc({ id: 'mine', name: 'Logo pack', uploaded_by: 'client-user', uploaded_by_kind: 'client' }),
                doc({ id: 'empty', name: 'Never finished' }),
                doc({ id: 'dead-project', name: 'Old', project_id: 'p9', projects: { name: 'Gone', deleted_at: '2026-09-01' } }),
            ],
            document_files: [
                { document_id: 'shared', version: 1, file_name: 'a.pdf', size_bytes: 10, mime_type: 'application/pdf', status: 'ready' },
                { document_id: 'internal', version: 1, file_name: 'b.pdf', size_bytes: 10, mime_type: 'application/pdf', status: 'ready' },
                { document_id: 'other-client', version: 1, file_name: 'c.pdf', size_bytes: 10, mime_type: 'application/pdf', status: 'ready' },
                { document_id: 'mine', version: 1, file_name: 'd.zip', size_bytes: 10, mime_type: 'application/zip', status: 'ready' },
                { document_id: 'empty', version: 1, file_name: 'e.pdf', size_bytes: 10, mime_type: 'application/pdf', status: 'pending' },
                { document_id: 'dead-project', version: 1, file_name: 'f.pdf', size_bytes: 10, mime_type: 'application/pdf', status: 'ready' },
            ],
        });
    });

    it('returns only shared, finished documents of this client', async () => {
        const rows = await listClientDocuments('a1', 'c1', 'client-user');
        expect(rows.map((row) => row.id).sort()).toEqual(['mine', 'shared']);
    });

    it('never exposes who uploaded a file, only whether it was you', async () => {
        const rows = await listClientDocuments('a1', 'c1', 'client-user');
        for (const row of rows) {
            expect(row).not.toHaveProperty('uploaded_by');
            expect(row).not.toHaveProperty('uploaded_by_kind');
            expect(row).not.toHaveProperty('visibility');
        }
        expect(rows.find((row) => row.id === 'mine')?.from_you).toBe(true);
        expect(rows.find((row) => row.id === 'shared')?.from_you).toBe(false);
    });
});
