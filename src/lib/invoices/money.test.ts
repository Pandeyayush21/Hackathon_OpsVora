import { describe, expect, it } from 'vitest';
import { computeTotals, displayStatus, formatMoney, fromMinor, lineAmount, toMinor } from './money';

describe('toMinor / fromMinor', () => {
    it('handles two-decimal currencies', () => {
        expect(toMinor('10.50', 'USD')).toBe(BigInt(1050));
        expect(fromMinor(BigInt(1050), 'USD')).toBe('10.50');
        expect(toMinor(0.5, 'USD')).toBe(BigInt(50));
    });

    it('handles zero-decimal currencies', () => {
        expect(toMinor('100', 'JPY')).toBe(BigInt(100));
        expect(fromMinor(BigInt(100), 'JPY')).toBe('100');
        expect(() => toMinor('100.5', 'JPY')).toThrow(/decimal/);
    });

    it('handles three-decimal currencies', () => {
        expect(toMinor('1.234', 'KWD')).toBe(BigInt(1234));
        expect(fromMinor(BigInt(1234), 'KWD')).toBe('1.234');
        expect(() => toMinor('1.2345', 'KWD')).toThrow(/decimal/);
    });
});

describe('lineAmount', () => {
    it('rounds half away from zero', () => {
        // 0.5 * 1 = 0.5 → 1
        expect(lineAmount(BigInt(500), BigInt(1))).toBe(BigInt(1));
        // 1.5 * 1 = 1.5 → 2
        expect(lineAmount(BigInt(1500), BigInt(1))).toBe(BigInt(2));
        // 2.675 * 1000 milli? quantity 2675 milli * unit 1 = 2.675 → 3
        expect(lineAmount(BigInt(2675), BigInt(1))).toBe(BigInt(3));
        // quantity 1.5 (1500) * unit 100 = 150 → exact
        expect(lineAmount(BigInt(1500), BigInt(100))).toBe(BigInt(150));
    });
});

describe('computeTotals', () => {
    it('applies percent and amount discounts and tax', () => {
        const base = computeTotals({
            lines: [{ amount_minor: BigInt(10000) }],
            discount: { kind: 'percent', valueBps: 1000 }, // 10%
            taxBps: 2000, // 20%
        });
        expect(base.subtotal).toBe(BigInt(10000));
        expect(base.discountMinor).toBe(BigInt(1000));
        expect(base.taxable).toBe(BigInt(9000));
        expect(base.taxMinor).toBe(BigInt(1800));
        expect(base.total).toBe(BigInt(10800));

        const amount = computeTotals({
            lines: [{ amount_minor: BigInt(10000) }],
            discount: { kind: 'amount', valueMinor: BigInt(2500) },
            taxBps: 0,
        });
        expect(amount.discountMinor).toBe(BigInt(2500));
        expect(amount.total).toBe(BigInt(7500));

        const full = computeTotals({
            lines: [{ amount_minor: BigInt(5000) }],
            discount: { kind: 'percent', valueBps: 10000 },
            taxBps: 2700,
        });
        expect(full.discountMinor).toBe(BigInt(5000));
        expect(full.taxable).toBe(BigInt(0));
        expect(full.taxMinor).toBe(BigInt(0));
        expect(full.total).toBe(BigInt(0));
    });

    it('handles large values without float drift', () => {
        const totals = computeTotals({
            lines: [{ amount_minor: BigInt('9000000000000') }],
            discount: null,
            taxBps: 2700,
        });
        expect(totals.taxMinor).toBe(BigInt('2430000000000'));
        expect(totals.total).toBe(BigInt('11430000000000'));
    });
});

describe('displayStatus', () => {
    const base = { status: 'sent' as const, viewed_at: null as string | null, paid_minor: 0, total_minor: 1000, due_date: '2026-10-10' };

    it('derives viewed, partly paid, and overdue', () => {
        expect(displayStatus(base, '2026-10-10')).toBe('sent');
        expect(displayStatus({ ...base, viewed_at: '2026-10-01T00:00:00Z' }, '2026-10-10')).toBe('viewed');
        expect(displayStatus({ ...base, paid_minor: 400 }, '2026-10-10')).toBe('partly_paid');
        expect(displayStatus(base, '2026-10-11')).toBe('overdue');
        expect(displayStatus({ ...base, status: 'paid' }, '2026-10-20')).toBe('paid');
        expect(displayStatus({ ...base, status: 'void' }, '2026-10-20')).toBe('void');
    });
});

describe('formatMoney', () => {
    it('formats with Intl', () => {
        expect(formatMoney(BigInt(1050), 'USD', 'en-US')).toContain('10.50');
        expect(formatMoney(BigInt(100), 'JPY', 'en-US')).toMatch(/100/);
    });
});
