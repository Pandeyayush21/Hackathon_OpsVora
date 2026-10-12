import { describe, expect, it } from 'vitest';
import { editableFields, validateInvoiceInput, validatePayment, validateSettings } from './rules';

describe('validateInvoiceInput', () => {
    it('requires a client and valid lines on create', () => {
        expect(validateInvoiceInput({}, { create: true }).ok).toBe(false);
        const ok = validateInvoiceInput(
            {
                client_id: 'c1',
                currency: 'USD',
                tax_bps: 2000,
                lines: [{ description: 'Design', quantity_milli: 1000, unit_minor: 10000 }],
            },
            { create: true }
        );
        expect(ok.ok).toBe(true);
        if (ok.ok) expect(ok.value.lines?.[0].amount_minor).toBe(10000);
    });

    it('rejects bad payment links and tax', () => {
        expect(validateInvoiceInput({ payment_link: 'http://example.com' }, { partial: true }).ok).toBe(false);
        expect(validateInvoiceInput({ tax_bps: 10001 }, { partial: true }).ok).toBe(false);
    });

    it('rejects oversized unit prices and discount amounts', () => {
        expect(validateInvoiceInput({
            client_id: 'c1',
            currency: 'USD',
            lines: [{ description: 'Huge', quantity_milli: 1000, unit_minor: 1e12 + 1 }],
        }, { create: true }).ok).toBe(false);
        expect(validateInvoiceInput({ discount_kind: 'amount', discount_value: 1e12 + 1 }, { partial: true }).ok).toBe(false);
        expect(validateInvoiceInput({ discount_kind: 'percent', discount_value: 10001 }, { partial: true }).ok).toBe(false);
    });
});

describe('validateSettings', () => {
    it('only lets next_number move up', () => {
        const bad = validateSettings({ next_number: 2, default_currency: 'USD' }, 5);
        expect(bad.ok).toBe(false);
        const good = validateSettings({ next_number: 6, default_currency: 'USD', number_prefix: 'INV-' }, 5);
        expect(good.ok).toBe(true);
    });

    it('enables reminders only when explicitly true', () => {
        const off = validateSettings({ default_currency: 'USD', number_prefix: 'INV-', next_number: 1 }, 1);
        expect(off.ok && off.value.reminders_enabled).toBe(false);
        const on = validateSettings({ default_currency: 'USD', number_prefix: 'INV-', next_number: 1, reminders_enabled: true }, 1);
        expect(on.ok && on.value.reminders_enabled).toBe(true);
    });
});

describe('validatePayment', () => {
    it('rejects overpayment', () => {
        expect(validatePayment({ amount_minor: 200, method: 'cash' }, 100).ok).toBe(false);
        expect(validatePayment({ amount_minor: 50, method: 'card', paid_on: '2026-10-01' }, 100).ok).toBe(true);
    });
});

describe('editableFields', () => {
    it('narrows fields after send', () => {
        expect(editableFields('draft').has('lines')).toBe(true);
        expect(editableFields('sent').has('lines')).toBe(false);
        expect(editableFields('sent').has('due_date')).toBe(true);
        expect(editableFields('paid').has('internal_note')).toBe(true);
        expect(editableFields('paid').has('notes')).toBe(false);
    });
});

describe('zero-decimal currencies', () => {
    it('accepts JPY and KRW on invoices and in settings', () => {
        expect(validateInvoiceInput({ currency: 'JPY' }, { partial: true }).ok).toBe(true);
        expect(validateInvoiceInput({ currency: 'KRW' }, { partial: true }).ok).toBe(true);
        expect(validateInvoiceInput({ currency: 'XYZ' }, { partial: true }).ok).toBe(false);
        expect(validateSettings({ default_currency: 'JPY', number_prefix: 'INV-', next_number: 1 }, 1).ok).toBe(true);
    });

    it('leaves currency and tax unset on create so agency defaults apply', () => {
        const parsed = validateInvoiceInput({ client_id: '00000000-0000-0000-0000-000000000001', lines: [{ description: 'Work', quantity_milli: 1000, unit_minor: 100 }] }, { create: true });
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
            expect(parsed.value.currency).toBeUndefined();
            expect(parsed.value.tax_bps).toBeUndefined();
        }
    });
});
