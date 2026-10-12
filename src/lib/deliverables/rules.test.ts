import { describe, expect, it } from 'vitest';
import {
    canDecide,
    canEditDeliverable,
    canSubmit,
    nextStatusAfter,
    validateDeliverableInput,
    validateFileIntent,
    validateVersionInput,
} from './rules';
import type { DeliverableStatus } from '@/lib/types/database';

const perms = ['deliverables.create', 'deliverables.submit', 'deliverables.approve'];

describe('validateDeliverableInput', () => {
    it('requires a title and project on create', () => {
        expect(validateDeliverableInput({ title: 'Homepage', project_id: 'not-a-uuid' }).ok).toBe(false);
        const ok = validateDeliverableInput({ title: 'Homepage', project_id: '11111111-1111-1111-1111-111111111111', due_date: '2026-10-02', task_id: null });
        expect(ok.ok && ok.value.title).toBe('Homepage');
    });

    it('rejects a title outside 1 to 160 characters', () => {
        expect(validateDeliverableInput({ title: '' }, { partial: true }).ok).toBe(false);
        expect(validateDeliverableInput({ title: 'a'.repeat(161) }, { partial: true }).ok).toBe(false);
    });
});

describe('validateVersionInput', () => {
    it('accepts https links and rejects others', () => {
        const ok = validateVersionInput({ note: 'See Figma', links: [{ url: 'https://figma.com/file/abc', label: 'Figma' }] });
        expect(ok.ok && ok.value.links).toHaveLength(1);
        expect(validateVersionInput({ links: [{ url: 'http://example.com', label: 'x' }] }).ok).toBe(false);
        expect(validateVersionInput({ note: 'a'.repeat(5001) }).ok).toBe(false);
        expect(validateVersionInput({ links: Array.from({ length: 11 }, () => ({ url: 'https://a.com', label: 'a' })) }).ok).toBe(false);
    });
});

describe('validateFileIntent', () => {
    it('blocks executable types and oversized files', () => {
        expect(validateFileIntent({ name: 'design.pdf', size: 30 * 1024 * 1024 }).ok).toBe(true);
        expect(validateFileIntent({ name: 'setup.exe', size: 10 }).ok).toBe(false);
        expect(validateFileIntent({ name: 'page.HTML', size: 10 }).ok).toBe(false);
        expect(validateFileIntent({ name: 'evil.html.', size: 10 }).ok).toBe(false);
        expect(validateFileIntent({ name: 'evil.html .. ', size: 10 }).ok).toBe(false);
        expect(validateFileIntent({ name: 'page.htm', size: 10 }).ok).toBe(false);
        expect(validateFileIntent({ name: 'mod.mjs', size: 10 }).ok).toBe(false);
        const stripped = validateFileIntent({ name: 'folder/home.pdf', size: 10 });
        expect(stripped.ok && stripped.value.name).toBe('folderhome.pdf');
        expect(validateFileIntent({ name: 'big.zip', size: 60 * 1024 * 1024 }).ok).toBe(false);
        expect(validateFileIntent({ name: 'a.pdf', size: 10, existingCount: 20 }).ok).toBe(false);
    });
});

describe('permissions', () => {
    const draft = { status: 'draft', created_by: 'u1' };

    it('lets leads edit any non-approved deliverable and creators only their drafts', () => {
        expect(canEditDeliverable({ role: 'admin', userId: 'u2', deliverable: draft, permissions: perms })).toBe(true);
        expect(canEditDeliverable({ role: 'admin', userId: 'u2', deliverable: { status: 'approved', created_by: 'u2' }, permissions: perms })).toBe(false);
        expect(canEditDeliverable({ role: 'creator', userId: 'u1', deliverable: draft, permissions: perms })).toBe(true);
        expect(canEditDeliverable({ role: 'creator', userId: 'u1', deliverable: { status: 'in_review', created_by: 'u1' }, permissions: perms })).toBe(false);
        expect(canEditDeliverable({ role: 'creator', userId: 'u2', deliverable: draft, permissions: perms })).toBe(false);
        expect(canEditDeliverable({ role: 'creator', userId: 'u1', deliverable: { status: 'changes_requested', created_by: 'u1' }, permissions: perms })).toBe(true);
    });

    it('sends only an unsent current version that has a file or link on an open project', () => {
        const base = {
            permissions: perms,
            deliverable: { status: 'draft', current_version: 1 },
            version: { version: 1, sent_at: null as string | null, readyFiles: 1, links: 0 },
            project: { status: 'active' },
        };
        expect(canSubmit(base)).toBe(true);
        expect(canSubmit({ ...base, version: { ...base.version, sent_at: '2026-01-01' } })).toBe(false);
        expect(canSubmit({ ...base, version: { ...base.version, readyFiles: 0 } })).toBe(false);
        expect(canSubmit({ ...base, version: { ...base.version, readyFiles: 0, links: 1 } })).toBe(true);
        expect(canSubmit({ ...base, deliverable: { status: 'changes_requested', current_version: 1 }, version: { ...base.version, sent_at: '2026-01-01' } })).toBe(false);
        expect(canSubmit({ ...base, project: { status: 'completed' } })).toBe(false);
        expect(canSubmit({ ...base, permissions: ['deliverables.create'] })).toBe(false);
    });

    it('lets the client or a lead decide the current in-review version', () => {
        const deliverable = { status: 'in_review', current_version: 2 };
        expect(canDecide({ role: 'client', permissions: perms, deliverable, version: 2 })).toBe('client');
        expect(canDecide({ role: 'manager', permissions: perms, deliverable, version: 2 })).toBe('staff_for_client');
        expect(canDecide({ role: 'creator', permissions: perms, deliverable, version: 2 })).toBe(null);
        expect(canDecide({ role: 'client', permissions: perms, deliverable, version: 1 })).toBe(null);
        expect(canDecide({ role: 'client', permissions: perms, deliverable: { status: 'draft', current_version: 2 }, version: 2 })).toBe(null);
    });
});

describe('nextStatusAfter', () => {
    const legal: [Parameters<typeof nextStatusAfter>[0], DeliverableStatus | null, DeliverableStatus][] = [
        ['created', null, 'draft'],
        ['sent', 'draft', 'in_review'],
        ['changes_requested', 'in_review', 'changes_requested'],
        ['version_added', 'changes_requested', 'draft'],
        ['approved', 'in_review', 'approved'],
        ['reopened', 'approved', 'draft'],
        ['cancelled', 'draft', 'cancelled'],
        ['cancelled', 'in_review', 'cancelled'],
        ['cancelled', 'changes_requested', 'cancelled'],
        ['viewed', 'in_review', 'in_review'],
        ['viewed', 'approved', 'approved'],
    ];

    it('follows the state machine', () => {
        for (const [event, current, next] of legal) {
            expect(nextStatusAfter(event, current)).toBe(next);
        }
    });

    it('throws on illegal moves', () => {
        expect(() => nextStatusAfter('sent', 'approved')).toThrow('ILLEGAL_TRANSITION');
        expect(() => nextStatusAfter('approved', 'draft')).toThrow('ILLEGAL_TRANSITION');
        expect(() => nextStatusAfter('version_added', 'draft')).toThrow('ILLEGAL_TRANSITION');
        expect(() => nextStatusAfter('reopened', 'in_review')).toThrow('ILLEGAL_TRANSITION');
        expect(() => nextStatusAfter('cancelled', 'approved')).toThrow('ILLEGAL_TRANSITION');
        expect(() => nextStatusAfter('created', 'draft')).toThrow('ILLEGAL_TRANSITION');
        expect(() => nextStatusAfter('viewed', 'draft')).toThrow('ILLEGAL_TRANSITION');
    });
});
