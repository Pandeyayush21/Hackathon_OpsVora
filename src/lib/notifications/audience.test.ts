import { describe, expect, it } from 'vitest';
import { scopeFromContacts } from '@/lib/clients/scope';

describe('audience helpers', () => {
    it('client scope only includes active contacts', () => {
        const scope = scopeFromContacts('client', [
            { client_id: 'a', portal_status: 'active', deleted: false },
            { client_id: 'b', portal_status: 'invited', deleted: false },
            { client_id: 'c', portal_status: 'active', deleted: true },
        ]);
        expect(scope).toEqual({ kind: 'clients', ids: ['a'] });
    });

    it('staff see all clients', () => {
        expect(scopeFromContacts('admin', [])).toEqual({ kind: 'all' });
    });
});
