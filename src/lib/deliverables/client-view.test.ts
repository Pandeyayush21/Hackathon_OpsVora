import { describe, expect, it } from 'vitest';
import { clientEventView, clientListItem, clientVersionView } from './client-view';

describe('client deliverable shape', () => {
    it('hides drafts, unsent versions, and internal fields', () => {
        expect(clientListItem({ id: '1', title: 'Home', status: 'draft', project_name: 'Site', current_version: 1, submitted_at: null, due_date: null })).toBeNull();
        expect(clientListItem({ id: '1', title: 'Home', status: 'cancelled', project_name: 'Site', current_version: 1, submitted_at: null, due_date: null })).toBeNull();
        const shown = clientListItem({ id: '1', title: 'Home', status: 'in_review', project_name: 'Site', current_version: 2, submitted_at: '2026-10-01', due_date: null });
        expect(shown?.status).toBe('Waiting for you');

        const hidden = clientVersionView({ version: 2, note: 'draft', links: [], sent_at: null, files: [] });
        expect(hidden).toBeNull();
        const version = clientVersionView({
            version: 1,
            note: 'v1',
            links: [{ url: 'https://figma.com', label: 'Figma' }],
            sent_at: '2026-10-01',
            files: [{ id: 'f1', file_name: 'a.pdf', size_bytes: 10, mime_type: 'application/pdf', status: 'ready', storage_path: 'secret/path' }],
        });
        expect(version).not.toBeNull();
        expect(JSON.stringify(version)).not.toContain('storage_path');
        expect(JSON.stringify(version)).not.toContain('secret');

        const created = clientEventView({ version: 1, kind: 'created', actor_kind: 'staff', comment: null, created_at: '2026-10-01', actor_id: 'user-1' }, { actor_name: 'Sam', client_name: 'Acme' });
        expect(created).toBeNull();
        const decision = clientEventView({ version: 1, kind: 'changes_requested', actor_kind: 'client', comment: 'More contrast', created_at: '2026-10-02', actor_id: 'user-2' }, { actor_name: 'Jane', client_name: 'Acme' });
        expect(decision?.actor).toBe('Jane at Acme');
        expect(JSON.stringify(decision)).not.toContain('actor_id');
        expect(JSON.stringify(decision)).not.toContain('user-2');

        const onBehalf = clientEventView({ version: 1, kind: 'approved', actor_kind: 'staff_for_client', comment: 'They said yes by email', created_at: '2026-10-02' }, { actor_name: 'Sam', client_name: 'Acme' });
        expect(onBehalf?.actor).toBe('Sam for Acme');
    });
});
