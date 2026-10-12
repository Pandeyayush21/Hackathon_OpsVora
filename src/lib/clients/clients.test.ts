import { describe, expect, it } from 'vitest';
import { validateClientInput, validateContactInput } from './validate';
import { applyScope, scopeAllows, scopeFromContacts } from './scope';
import { mapClientInviteError } from './invites';

describe('validateClientInput', () => {
    it('trims the company name and normalizes the website', () => {
        const result = validateClientInput({ company_name: '  Northwind  ', website_url: 'northwind.com', tags: ['Design', 'design', 'Brand'] });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.company_name).toBe('Northwind');
            expect(result.value.website_url).toBe('https://northwind.com');
            expect(result.value.tags).toEqual(['design', 'brand']);
        }
    });

    it('rejects an empty name', () => {
        expect(validateClientInput({ company_name: '  ' }).ok).toBe(false);
    });
});

describe('validateContactInput', () => {
    it('requires a name and a real email when one is given', () => {
        expect(validateContactInput({ name: 'Ada' }).ok).toBe(true);
        expect(validateContactInput({ name: 'Ada', email: 'not-an-email' }).ok).toBe(false);
    });
});

describe('client scope', () => {
    it('gives staff every client and a client only active contacts', () => {
        expect(scopeFromContacts('admin', []).kind).toBe('all');
        expect(scopeFromContacts('client', [])).toEqual({ kind: 'clients', ids: [] });
        expect(scopeFromContacts('client', [
            { client_id: 'a', portal_status: 'disabled', deleted: false },
            { client_id: 'b', portal_status: 'active', deleted: true },
            { client_id: 'c', portal_status: 'active', deleted: false },
        ])).toEqual({ kind: 'clients', ids: ['c'] });
    });

    it('rejects a foreign id and matches nothing when the list is empty', () => {
        const empty = scopeFromContacts('client', []);
        expect(scopeAllows(empty, 'c')).toBe(false);
        expect(scopeAllows({ kind: 'clients', ids: ['c'] }, 'other')).toBe(false);
        const calls: string[] = [];
        const query = {
            in: (col: string, ids: string[]) => { calls.push(`in:${col}:${ids.join(',')}`); return query; },
            eq: (col: string, value: string) => { calls.push(`eq:${col}:${value}`); return query; },
        };
        applyScope(query, empty, 'client_id');
        expect(calls[0]?.startsWith('eq:client_id:')).toBe(true);
        applyScope(query, { kind: 'all' });
        expect(calls).toHaveLength(1);
    });
});

describe('mapClientInviteError', () => {
    it('maps a duplicate pending invite to 409', () => {
        expect(mapClientInviteError({ code: '23505', message: 'uq_client_invite_pending' }).status).toBe(409);
        expect(mapClientInviteError({ message: 'timeout' }).status).toBe(500);
    });
});
