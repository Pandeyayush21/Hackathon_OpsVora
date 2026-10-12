/**
 * Pure rules shared by the agreement APIs, jobs and UI: status transitions, recipient matching,
 * expiry windows and references. No database access.
 */
import { NextResponse } from 'next/server';
import type { AgreementKind, AgreementStatus, RecipientKind } from '@/lib/types/database';

export const AGREEMENT_KINDS: readonly AgreementKind[] = ['offer_letter', 'client_contract', 'nda', 'policy', 'other'];
export const RECIPIENT_KINDS: readonly RecipientKind[] = ['candidate', 'team_member', 'client_contact'];

export const STATUS_LABEL: Record<AgreementStatus, string> = {
    draft: 'Draft',
    sent: 'Awaiting signature',
    viewed: 'Opened',
    signed: 'Signed',
    declined: 'Declined',
    voided: 'Withdrawn',
    expired: 'Expired',
};

export const RECIPIENT_KIND_LABEL: Record<RecipientKind, string> = {
    candidate: 'Candidate',
    team_member: 'Team',
    client_contact: 'Client',
};

export const DEFAULT_EXPIRY_DAYS = 14;
export const MAX_EXPIRY_DAYS = 90;
/** Offer letters share the team invite window, so the invite can never outlive the offer. */
export const MAX_OFFER_EXPIRY_DAYS = 30;

const FINAL: readonly AgreementStatus[] = ['signed', 'declined', 'voided', 'expired'];

export function isFinal(status: AgreementStatus): boolean {
    return FINAL.includes(status);
}

/** Only an open, sent document can be signed or declined. */
export function isSignable(status: AgreementStatus): boolean {
    return status === 'sent' || status === 'viewed';
}

export function canVoid(status: AgreementStatus): boolean {
    return isSignable(status);
}

export function canEditDraft(status: AgreementStatus): boolean {
    return status === 'draft';
}

export function isExpired(expiresAt: string | null, now = Date.now()): boolean {
    return !!expiresAt && Date.parse(expiresAt) < now;
}

/** Signing is identity-based: the signed-in email must be the recipient email, case aside. */
export function recipientMatches(userEmail: string | null | undefined, recipientEmail: string): boolean {
    if (!userEmail) return false;
    return userEmail.trim().toLowerCase() === recipientEmail.trim().toLowerCase();
}

export function maxExpiryDays(kind: AgreementKind): number {
    return kind === 'offer_letter' ? MAX_OFFER_EXPIRY_DAYS : MAX_EXPIRY_DAYS;
}

export function validateExpiryDays(value: unknown, kind: AgreementKind): { ok: true; days: number } | { ok: false; error: string } {
    const max = maxExpiryDays(kind);
    if (value == null || value === '') return { ok: true, days: DEFAULT_EXPIRY_DAYS };
    const days = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(days) || days < 1 || days > max) {
        return { ok: false, error: `Choose between 1 and ${max} days.` };
    }
    return { ok: true, days };
}

export function expiryFromDays(days: number, from = Date.now()): string {
    return new Date(from + days * 86_400_000).toISOString();
}

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Short, readable public reference. Ambiguous characters are left out. */
export function newReference(random: () => number = Math.random): string {
    let out = '';
    for (let i = 0; i < 6; i++) out += REF_ALPHABET[Math.floor(random() * REF_ALPHABET.length)];
    return `AGR-${out}`;
}

export function isEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export interface RpcFailure {
    status: number;
    code: string;
    error: string;
}

const RPC_ERRORS: Record<string, RpcFailure> = {
    NOT_SIGNABLE: { status: 409, code: 'NOT_SIGNABLE', error: 'This document is no longer open for signing.' },
    NOT_VOIDABLE: { status: 409, code: 'NOT_VOIDABLE', error: 'Only a document waiting for a signature can be withdrawn.' },
    EXPIRED: { status: 409, code: 'EXPIRED', error: 'This document has expired. Ask for a new one.' },
    WRONG_RECIPIENT: { status: 404, code: 'NOT_FOUND', error: 'Not found' },
    HASH_MISMATCH: { status: 409, code: 'HASH_MISMATCH', error: 'This document changed. Reload the page and read it again before signing.' },
    CODE_REQUIRED: { status: 409, code: 'CODE_REQUIRED', error: 'Enter the code we emailed you before signing.' },
    BAD_METHOD: { status: 400, code: 'BAD_REQUEST', error: 'Choose how you want to sign.' },
    AGREEMENT_LOCKED: { status: 409, code: 'AGREEMENT_LOCKED', error: 'A sent document cannot be changed. Withdraw it and send a new one.' },
    // Checked before the generic JOIN_FAILED (first match wins).
    'JOIN_FAILED:ALREADY_MEMBER': { status: 409, code: 'ALREADY_MEMBER', error: 'You are already a member of this workspace, so this offer can no longer be used. Contact the agency.' },
    JOIN_FAILED: { status: 409, code: 'JOIN_FAILED', error: 'Your invite is no longer valid, so nothing was signed. Ask for a new offer.' },
    NOT_FOUND: { status: 404, code: 'NOT_FOUND', error: 'Not found' },
};

/** Turn a Postgres error from one of the agreement RPCs into the response the client should see. */
export function matchRpcFailure(message: string): RpcFailure | null {
    for (const key of Object.keys(RPC_ERRORS)) {
        if (message.includes(key)) return RPC_ERRORS[key];
    }
    return null;
}

export function mapRpcError(message: string): NextResponse | null {
    const failure = matchRpcFailure(message);
    if (!failure) return null;
    return NextResponse.json({ error: failure.error, code: failure.code }, { status: failure.status });
}

export const LIST_TABS = ['awaiting', 'signed', 'closed', 'drafts'] as const;
export type ListTab = (typeof LIST_TABS)[number];

export function statusesForTab(tab: string): AgreementStatus[] | null {
    if (tab === 'awaiting') return ['sent', 'viewed'];
    if (tab === 'signed') return ['signed'];
    if (tab === 'closed') return ['declined', 'voided', 'expired'];
    if (tab === 'drafts') return ['draft'];
    return null;
}
