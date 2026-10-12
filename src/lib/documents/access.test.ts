import { describe, expect, it } from 'vitest';
import { applyDocumentScope, canDeleteDocument, canEditDocument, canShare, type DocumentScope } from './access';

describe('document permissions', () => {
    const own = { uploaded_by: 'u1', uploaded_by_kind: 'staff' };
    const clientOwn = { uploaded_by: 'c1', uploaded_by_kind: 'client' };

    it('lets leads share and edit any document', () => {
        expect(canShare(['documents.share'])).toBe(true);
        expect(canShare(['documents.upload'])).toBe(false);
        expect(canEditDocument({ role: 'manager', userId: 'u2', document: own, permissions: ['documents.upload'] })).toBe(true);
        expect(canDeleteDocument({ role: 'admin', userId: 'u2', document: own, permissions: ['documents.delete'] })).toBe(true);
    });

    it('lets creators edit only their own uploads and never share by default', () => {
        expect(canEditDocument({ role: 'creator', userId: 'u1', document: own, permissions: ['documents.upload'] })).toBe(true);
        expect(canEditDocument({ role: 'creator', userId: 'u2', document: own, permissions: ['documents.upload'] })).toBe(false);
        expect(canDeleteDocument({ role: 'creator', userId: 'u1', document: own, permissions: ['documents.upload'] })).toBe(false);
    });

    it('lets clients edit and delete only their own uploads', () => {
        expect(canEditDocument({ role: 'client', userId: 'c1', document: clientOwn, permissions: ['documents.client_upload'] })).toBe(true);
        expect(canEditDocument({ role: 'client', userId: 'c1', document: own, permissions: ['documents.client_upload'] })).toBe(false);
        expect(canDeleteDocument({ role: 'client', userId: 'c1', document: clientOwn, permissions: ['documents.client_upload'] })).toBe(true);
        expect(canDeleteDocument({ role: 'client', userId: 'c2', document: clientOwn, permissions: ['documents.client_upload'] })).toBe(false);
    });
});

describe('applyDocumentScope', () => {
    function fakeQuery() {
        const calls: { op: string; args: unknown[] }[] = [];
        const q = {
            calls,
            in(col: string, vals: string[]) {
                calls.push({ op: 'in', args: [col, vals] });
                return q;
            },
            eq(col: string, val: string) {
                calls.push({ op: 'eq', args: [col, val] });
                return q;
            },
            is(col: string, val: null) {
                calls.push({ op: 'is', args: [col, val] });
                return q;
            },
            or(filter: string) {
                calls.push({ op: 'or', args: [filter] });
                return q;
            },
        };
        return q;
    }

    it('leaves admin/manager all-scope untouched', () => {
        const q = fakeQuery();
        applyDocumentScope(q, { kind: 'all' });
        expect(q.calls).toEqual([]);
    });

    it('filters creator to member clients and member-or-unlinked projects', () => {
        const q = fakeQuery();
        const scope: DocumentScope = { kind: 'filter', clientIds: ['c1'], projectIds: ['p1', 'p2'] };
        applyDocumentScope(q, scope);
        expect(q.calls).toContainEqual({ op: 'in', args: ['client_id', ['c1']] });
        expect(q.calls.some((c) => c.op === 'or' && String(c.args[0]).includes('project_id.is.null'))).toBe(true);
    });

    it('hides internal documents from the client portal scope', () => {
        const q = fakeQuery();
        const scope: DocumentScope = { kind: 'filter', clientIds: ['c1'], projectIds: null, visibility: 'client' };
        applyDocumentScope(q, scope);
        expect(q.calls).toContainEqual({ op: 'eq', args: ['visibility', 'client'] });
        expect(q.calls.some((c) => c.op === 'or')).toBe(false);
    });
});
