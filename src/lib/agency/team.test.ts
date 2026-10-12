import { describe, expect, it } from 'vitest';
import { blocksLastAdmin, mapInviteError, seatsUsed } from './team';

describe('seatsUsed', () => {
    it('counts active members and pending invites', () => {
        expect(seatsUsed(2, 1)).toBe(3);
        expect(seatsUsed(0, 0)).toBe(0);
    });
});

describe('blocksLastAdmin', () => {
    it('blocks demoting or removing the only admin', () => {
        expect(blocksLastAdmin(1, 'admin', 'manager')).toBe(true);
        expect(blocksLastAdmin(1, 'admin', null)).toBe(true);
        expect(blocksLastAdmin(2, 'admin', 'creator')).toBe(false);
        expect(blocksLastAdmin(1, 'manager', null)).toBe(false);
        expect(blocksLastAdmin(1, 'admin', 'admin')).toBe(false);
    });
});

describe('mapInviteError', () => {
    it('maps a duplicate pending email to 409', () => {
        const mapped = mapInviteError({ code: '23505', message: 'duplicate key value violates team_member_invites_pending_email' });
        expect(mapped.status).toBe(409);
        expect(mapped.code).toBe('ALREADY_INVITED');
    });

    it('maps other failures to 500', () => {
        expect(mapInviteError({ message: 'connection reset' }).status).toBe(500);
    });
});
