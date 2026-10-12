import { CURRENCIES, currencyDigits, lineAmount } from './money';
import type { InvoiceDiscountKind, InvoicePaymentMethod, InvoiceStatus } from '@/lib/types/database';

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; error: string };

function ok<T>(value: T): Ok<T> {
    return { ok: true, value };
}
function err(error: string): Err {
    return { ok: false, error };
}

function asString(value: unknown, max: number, label: string, required = false): Ok<string | null> | Err {
    if (value == null || value === '') return required ? err(`${label} is required.`) : ok(null);
    if (typeof value !== 'string') return err(`${label} must be text.`);
    const trimmed = value.trim();
    if (required && !trimmed) return err(`${label} is required.`);
    if (trimmed.length > max) return err(`${label} must be at most ${max} characters.`);
    return ok(trimmed || null);
}

function asDate(value: unknown, label: string): Ok<string | null> | Err {
    if (value == null || value === '') return ok(null);
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return err(`${label} must be a date.`);
    return ok(value);
}

export interface InvoiceLineInput {
    description: string;
    quantity_milli: number;
    unit_minor: number;
    amount_minor: number;
    position: number;
}

export interface InvoiceInputValue {
    client_id?: string;
    project_id?: string | null;
    currency?: string;
    issue_date?: string | null;
    due_date?: string | null;
    notes?: string | null;
    internal_note?: string | null;
    payment_link?: string | null;
    discount_kind?: InvoiceDiscountKind | null;
    discount_value?: number;
    tax_bps?: number;
    tax_label?: string;
    lines?: InvoiceLineInput[];
}

export function validateInvoiceInput(body: Record<string, unknown>, opts: { partial?: boolean; create?: boolean } = {}): Ok<InvoiceInputValue> | Err {
    const value: InvoiceInputValue = {};
    const create = opts.create === true;
    const partial = opts.partial === true;

    if ('client_id' in body || create) {
        if (typeof body.client_id !== 'string' || !body.client_id) return err('Choose a client.');
        value.client_id = body.client_id;
    }
    if ('project_id' in body) {
        value.project_id = typeof body.project_id === 'string' && body.project_id ? body.project_id : null;
    }
    // No currency on create: leave it unset so the agency's default currency applies.
    if ('currency' in body && body.currency != null) {
        const currency = typeof body.currency === 'string' ? body.currency.toUpperCase() : '';
        // 0 is a valid digit count (JPY, KRW), so check for "unknown", not falsy.
        if (currencyDigits(currency) == null) return err('Unknown currency.');
        value.currency = currency;
    }
    if ('issue_date' in body) {
        const d = asDate(body.issue_date, 'Issue date');
        if (!d.ok) return d;
        value.issue_date = d.value;
    }
    if ('due_date' in body) {
        const d = asDate(body.due_date, 'Due date');
        if (!d.ok) return d;
        value.due_date = d.value;
    }
    if ('notes' in body) {
        const n = asString(body.notes, 5000, 'Notes');
        if (!n.ok) return n;
        value.notes = n.value;
    }
    if ('internal_note' in body) {
        const n = asString(body.internal_note, 5000, 'Internal note');
        if (!n.ok) return n;
        value.internal_note = n.value;
    }
    if ('payment_link' in body) {
        if (body.payment_link == null || body.payment_link === '') value.payment_link = null;
        else if (typeof body.payment_link !== 'string') return err('Payment link must be text.');
        else {
            const link = body.payment_link.trim();
            if (link.length > 2000) return err('Payment link must be at most 2000 characters.');
            if (link && !/^https:\/\//i.test(link)) return err('Payment link must start with https://.');
            value.payment_link = link || null;
        }
    }
    // Unset on create means "use the agency default" (applied by the service).
    if ('tax_bps' in body && body.tax_bps != null) {
        const tax = typeof body.tax_bps === 'number' ? body.tax_bps : NaN;
        if (!Number.isInteger(tax) || tax < 0 || tax > 10000) return err('Tax must be between 0 and 100%.');
        value.tax_bps = tax;
    }
    if ('tax_label' in body && body.tax_label != null) {
        const label = typeof body.tax_label === 'string' && body.tax_label.trim() ? body.tax_label.trim() : 'Tax';
        if (label.length > 20) return err('Tax label must be at most 20 characters.');
        value.tax_label = label;
    }
    if ('discount_kind' in body || 'discount_value' in body) {
        const kind = body.discount_kind === 'percent' || body.discount_kind === 'amount' ? body.discount_kind : null;
        const raw = typeof body.discount_value === 'number' ? body.discount_value : 0;
        if (kind && (!Number.isInteger(raw) || raw < 0)) return err('Discount must be a non-negative integer.');
        if (kind === 'percent' && raw > 10000) return err('Discount percent cannot exceed 100%.');
        if (kind === 'amount' && raw > 1e12) return err('Discount amount is too large.');
        value.discount_kind = kind;
        value.discount_value = kind ? raw : 0;
    }
    if ('lines' in body || create) {
        if (!Array.isArray(body.lines)) return err('Add at least one line.');
        if (body.lines.length < 1 || body.lines.length > 100) return err('Use between 1 and 100 lines.');
        const lines: InvoiceLineInput[] = [];
        let running = 0;
        for (let i = 0; i < body.lines.length; i++) {
            const row = body.lines[i] && typeof body.lines[i] === 'object' ? (body.lines[i] as Record<string, unknown>) : {};
            const description = typeof row.description === 'string' ? row.description.trim() : '';
            if (!description || description.length > 500) return err(`Line ${i + 1}: description must be 1 to 500 characters.`);
            const quantityMilli = typeof row.quantity_milli === 'number' ? row.quantity_milli : Math.round(Number(row.quantity ?? 1) * 1000);
            if (!Number.isInteger(quantityMilli) || quantityMilli < 1 || quantityMilli > 1_000_000_000) {
                return err(`Line ${i + 1}: quantity must be between 0.001 and 1,000,000.`);
            }
            const unitMinor = typeof row.unit_minor === 'number' ? row.unit_minor : 0;
            if (!Number.isInteger(unitMinor) || unitMinor < 0 || unitMinor > 1e12) {
                return err(`Line ${i + 1}: unit price must be between 0 and 1e12.`);
            }
            const amount = Number(lineAmount(quantityMilli, unitMinor));
            if (!Number.isSafeInteger(amount)) return err(`Line ${i + 1}: amount is too large.`);
            running += amount;
            if (!Number.isSafeInteger(running)) return err('Invoice total is too large.');
            lines.push({
                description,
                quantity_milli: quantityMilli,
                unit_minor: unitMinor,
                amount_minor: amount,
                position: i,
            });
        }
        value.lines = lines;
    }
    if (partial && !Object.keys(value).length) return err('Nothing to update.');
    return ok(value);
}

export interface SettingsInput {
    business_name: string;
    business_address: string;
    tax_id: string;
    default_currency: string;
    default_tax_bps: number;
    tax_label: string;
    default_terms_days: number;
    number_prefix: string;
    next_number: number;
    payment_instructions: string;
    footer_note: string;
    reminders_enabled: boolean;
}

export function validateSettings(body: Record<string, unknown>, currentNext: number): Ok<SettingsInput> | Err {
    const business_name = typeof body.business_name === 'string' ? body.business_name.trim() : '';
    if (business_name.length > 200) return err('Business name must be at most 200 characters.');
    const business_address = typeof body.business_address === 'string' ? body.business_address.trim() : '';
    if (business_address.length > 1000) return err('Address must be at most 1000 characters.');
    const tax_id = typeof body.tax_id === 'string' ? body.tax_id.trim() : '';
    if (tax_id.length > 100) return err('Tax ID must be at most 100 characters.');
    const default_currency = typeof body.default_currency === 'string' ? body.default_currency.toUpperCase() : 'USD';
    if (CURRENCIES[default_currency] == null) return err('Unknown currency.');
    const default_tax_bps = typeof body.default_tax_bps === 'number' ? body.default_tax_bps : 0;
    if (!Number.isInteger(default_tax_bps) || default_tax_bps < 0 || default_tax_bps > 10000) return err('Tax must be between 0 and 100%.');
    const tax_label = typeof body.tax_label === 'string' && body.tax_label.trim() ? body.tax_label.trim() : 'Tax';
    if (tax_label.length > 20) return err('Tax label must be at most 20 characters.');
    const default_terms_days = typeof body.default_terms_days === 'number' ? body.default_terms_days : 30;
    if (!Number.isInteger(default_terms_days) || default_terms_days < 0 || default_terms_days > 365) return err('Terms must be 0 to 365 days.');
    const number_prefix = typeof body.number_prefix === 'string' ? body.number_prefix.trim() : 'INV-';
    if (!number_prefix || number_prefix.length > 20) return err('Prefix must be 1 to 20 characters.');
    const next_number = typeof body.next_number === 'number' ? body.next_number : currentNext;
    if (!Number.isInteger(next_number) || next_number < 1) return err('Next number must be at least 1.');
    if (next_number < currentNext) return err('Next number can only move up.');
    const payment_instructions = typeof body.payment_instructions === 'string' ? body.payment_instructions.trim() : '';
    if (payment_instructions.length > 5000) return err('Payment instructions must be at most 5000 characters.');
    const footer_note = typeof body.footer_note === 'string' ? body.footer_note.trim() : '';
    if (footer_note.length > 1000) return err('Footer note must be at most 1000 characters.');
    const reminders_enabled = body.reminders_enabled === true;
    return ok({
        business_name,
        business_address,
        tax_id,
        default_currency,
        default_tax_bps,
        tax_label,
        default_terms_days,
        number_prefix,
        next_number,
        payment_instructions,
        footer_note,
        reminders_enabled,
    });
}

export function validatePayment(
    body: Record<string, unknown>,
    remainingMinor: number
): Ok<{ amount_minor: number; paid_on: string; method: InvoicePaymentMethod; reference: string | null; note: string | null }> | Err {
    const amount_minor = typeof body.amount_minor === 'number' ? body.amount_minor : 0;
    if (!Number.isInteger(amount_minor) || amount_minor <= 0) return err('Amount must be greater than zero.');
    if (amount_minor > remainingMinor) return err('That is more than the remaining balance.');
    const paid = asDate(body.paid_on, 'Paid on');
    if (!paid.ok) return paid;
    const method = body.method;
    if (method !== 'bank_transfer' && method !== 'card' && method !== 'cash' && method !== 'cheque' && method !== 'other') {
        return err('Choose a payment method.');
    }
    const reference = asString(body.reference, 200, 'Reference');
    if (!reference.ok) return reference;
    const note = asString(body.note, 1000, 'Note');
    if (!note.ok) return note;
    return ok({
        amount_minor,
        paid_on: paid.value ?? new Date().toISOString().slice(0, 10),
        method,
        reference: reference.value,
        note: note.value,
    });
}

export function editableFields(status: InvoiceStatus): Set<string> {
    if (status === 'draft') {
        return new Set([
            'client_id', 'project_id', 'currency', 'issue_date', 'due_date', 'notes', 'internal_note',
            'payment_link', 'discount_kind', 'discount_value', 'tax_bps', 'tax_label', 'lines',
        ]);
    }
    if (status === 'sent') return new Set(['due_date', 'notes', 'payment_link', 'internal_note']);
    return new Set(['internal_note']);
}
