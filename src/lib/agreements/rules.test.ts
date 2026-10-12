import { describe, expect, it } from 'vitest';
import {
    canEditDraft,
    canVoid,
    isExpired,
    isFinal,
    isSignable,
    matchRpcFailure,
    maxExpiryDays,
    newReference,
    recipientMatches,
    statusesForTab,
    validateExpiryDays,
} from './rules';
import type { AgreementStatus } from '@/lib/types/database';

const ALL: AgreementStatus[] = ['draft', 'sent', 'viewed', 'signed', 'declined', 'voided', 'expired'];

describe('status transitions', () => {
    it('treats only sent and viewed as open', () => {
        expect(ALL.filter(isSignable)).toEqual(['sent', 'viewed']);
        expect(ALL.filter(canVoid)).toEqual(['sent', 'viewed']);
        expect(ALL.filter(canEditDraft)).toEqual(['draft']);
    });

    it('treats signed, declined, voided and expired as final', () => {
        expect(ALL.filter(isFinal)).toEqual(['signed', 'declined', 'voided', 'expired']);
    });

    it('never calls a final status signable', () => {
        for (const status of ALL) expect(isFinal(status) && isSignable(status)).toBe(false);
    });
});

describe('recipientMatches', () => {
    it('ignores case and surrounding spaces', () => {
        expect(recipientMatches(' Priya@Example.com ', 'priya@example.com')).toBe(true);
    });

    it('refuses a different address or no address at all', () => {
        expect(recipientMatches('someone@example.com', 'priya@example.com')).toBe(false);
        expect(recipientMatches(null, 'priya@example.com')).toBe(false);
        expect(recipientMatches('', 'priya@example.com')).toBe(false);
        expect(recipientMatches('priya@example.com.evil.test', 'priya@example.com')).toBe(false);
    });
});

describe('expiry', () => {
    it('defaults to 14 days and caps offer letters at 30', () => {
        expect(validateExpiryDays(null, 'nda')).toEqual({ ok: true, days: 14 });
        expect(maxExpiryDays('offer_letter')).toBe(30);
        expect(validateExpiryDays(31, 'offer_letter')).toEqual({ ok: false, error: 'Choose between 1 and 30 days.' });
        expect(validateExpiryDays(31, 'nda')).toEqual({ ok: true, days: 31 });
        expect(validateExpiryDays(0, 'nda')).toMatchObject({ ok: false });
        expect(validateExpiryDays(1.5, 'nda')).toMatchObject({ ok: false });
    });

    it('reads a past expiry as expired and no expiry as open', () => {
        const now = Date.parse('2026-10-02T00:00:00.000Z');
        expect(isExpired('2026-10-01T00:00:00.000Z', now)).toBe(true);
        expect(isExpired('2026-10-03T00:00:00.000Z', now)).toBe(false);
        expect(isExpired(null, now)).toBe(false);
    });
});

describe('newReference', () => {
    it('is AGR- plus six unambiguous characters', () => {
        expect(newReference(() => 0)).toBe('AGR-AAAAAA');
        for (let i = 0; i < 50; i++) expect(newReference()).toMatch(/^AGR-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    });
});

describe('matchRpcFailure', () => {
    it('hides a wrong recipient behind a 404', () => {
        expect(matchRpcFailure('WRONG_RECIPIENT')).toEqual({ status: 404, code: 'NOT_FOUND', error: 'Not found' });
    });

    it('maps the integrity errors to conflicts', () => {
        expect(matchRpcFailure('P0001: HASH_MISMATCH')).toMatchObject({ status: 409, code: 'HASH_MISMATCH' });
        expect(matchRpcFailure('AGREEMENT_LOCKED')).toMatchObject({ status: 409, code: 'AGREEMENT_LOCKED' });
        expect(matchRpcFailure('JOIN_FAILED:INVITE_USED')).toMatchObject({ status: 409, code: 'JOIN_FAILED' });
        expect(matchRpcFailure('something else entirely')).toBeNull();
    });
});

describe('statusesForTab', () => {
    it('groups the list tabs', () => {
        expect(statusesForTab('awaiting')).toEqual(['sent', 'viewed']);
        expect(statusesForTab('closed')).toEqual(['declined', 'voided', 'expired']);
        expect(statusesForTab('all')).toBeNull();
    });
});
