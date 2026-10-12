import { describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFPage, StandardFonts } from 'pdf-lib';
import { formatPdfMoney, renderInvoicePdf, toWinAnsi } from './pdf';

describe('toWinAnsi', () => {
    it('strips accents so Helvetica never crashes', () => {
        expect(toWinAnsi('Café résumé')).toBe('Cafe resume');
        expect(toWinAnsi('日本語')).toBe('???');
    });
});

describe('formatPdfMoney', () => {
    it('renders INR, KRW, TRY, ILS, PHP, THB, GBP, EUR, JPY without throwing', async () => {
        const doc = await PDFDocument.create();
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const cache = new Map<string, boolean>();
        const codes = ['INR', 'KRW', 'TRY', 'ILS', 'PHP', 'THB', 'GBP', 'EUR', 'JPY'];
        for (const currency of codes) {
            expect(() => formatPdfMoney(123456, currency, font, cache)).not.toThrow();
            const text = formatPdfMoney(123456, currency, font, cache);
            expect(text.length).toBeGreaterThan(0);
        }
    });
});

describe('renderInvoicePdf', () => {
    it('renders a draft with accented names', async () => {
        const bytes = await renderInvoicePdf({
            draft: true,
            agency: { name: 'Acme', logo_url: null, theme_primary_color: '#F59E0B' },
            number: null,
            currency: 'USD',
            issue_date: '2026-10-01',
            due_date: '2026-10-31',
            from: { name: 'Acmé Studio', address: '1 Rue Café', tax_id: 'VAT-1' },
            bill_to: { name: 'Cliente Señor', email: 'a@b.com' },
            lines: [
                { description: 'Diseño web with a very long description that should wrap across multiple lines on the page', quantity_milli: 1500, unit_minor: 10000, amount_minor: 15000 },
            ],
            subtotal_minor: 15000,
            discount_minor: 1500,
            tax_label: 'VAT',
            tax_minor: 2700,
            total_minor: 16200,
            payment_instructions: 'Pay by bank transfer',
            footer_note: 'Thank you',
        });
        expect(bytes.byteLength).toBeGreaterThan(500);
        expect(bytes[0]).toBe(0x25); // %PDF
    });

    it('paginates 100 long lines across multiple pages', async () => {
        const spy = vi.spyOn(PDFPage.prototype, 'drawText');
        const lines = Array.from({ length: 100 }, (_, i) => ({
            description: `Line ${i + 1} with a long description about deliverable work for the client project phase`,
            quantity_milli: 1000,
            unit_minor: 100,
            amount_minor: 100,
        }));
        const bytes = await renderInvoicePdf({
            agency: { name: 'Acme', logo_url: null, theme_primary_color: null },
            number: 'INV-0001',
            currency: 'GBP',
            issue_date: '2026-10-01',
            due_date: '2026-10-31',
            from: { name: 'Agency' },
            bill_to: { name: 'Client' },
            lines,
            subtotal_minor: 10000,
            discount_minor: 0,
            tax_label: 'VAT',
            tax_minor: 0,
            total_minor: 10000,
            notes: 'Notes go here',
            payment_instructions: 'Bank details here',
            footer_note: 'Footer note that should wrap if needed across the bottom',
        });
        const loaded = await PDFDocument.load(bytes);
        expect(loaded.getPageCount()).toBeGreaterThan(1);
        expect(bytes.byteLength).toBeGreaterThan(5_000);
        // Every line item must actually be drawn (none dropped when a page fills up).
        const drawn = spy.mock.calls.map((call) => String(call[0])).join(' | ');
        spy.mockRestore();
        for (let i = 1; i <= 100; i++) expect(drawn).toContain(`Line ${i} with`);
    });
});
