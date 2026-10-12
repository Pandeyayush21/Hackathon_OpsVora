import type { InvoiceDisplayStatus, InvoiceStatus } from '@/lib/types/database';

const ZERO = BigInt(0);
const FIVE_HUNDRED = BigInt(500);
const FIVE_THOUSAND = BigInt(5000);
const ONE_THOUSAND = BigInt(1000);
const TEN_THOUSAND = BigInt(10000);

function pow10(digits: number): bigint {
    return BigInt(`1${'0'.repeat(digits)}`);
}

/** ISO currency → number of minor-unit digits. */
export const CURRENCIES: Record<string, number> = {
    AED: 2, AUD: 2, BHD: 3, BRL: 2, CAD: 2, CHF: 2, CNY: 2, CZK: 2, DKK: 2,
    EUR: 2, GBP: 2, HKD: 2, HUF: 2, IDR: 2, ILS: 2, INR: 2, JPY: 0, KRW: 0,
    KWD: 3, MXN: 2, MYR: 2, NOK: 2, NZD: 2, OMR: 3, PHP: 2, PLN: 2, QAR: 2,
    RUB: 2, SAR: 2, SEK: 2, SGD: 2, THB: 2, TRY: 2, TWD: 2, USD: 2, ZAR: 2,
};

export function currencyDigits(code: string) {
    return CURRENCIES[code] ?? null;
}

export function toMinor(value: string | number, currency: string): bigint {
    const digits = currencyDigits(currency);
    if (digits == null) throw new Error(`Unknown currency ${currency}`);
    const raw = typeof value === 'number' ? value.toString() : value.trim();
    if (!/^-?\d+(\.\d+)?$/.test(raw)) throw new Error('Invalid money amount.');
    const negative = raw.startsWith('-');
    const [wholePart, frac = ''] = (negative ? raw.slice(1) : raw).split('.');
    if (frac.length > digits) throw new Error(`At most ${digits} decimal places.`);
    const fracPadded = (frac + '0'.repeat(digits)).slice(0, digits);
    const minor = BigInt(wholePart || '0') * pow10(digits) + BigInt(fracPadded || '0');
    return negative ? -minor : minor;
}

export function fromMinor(minor: bigint | number, currency: string): string {
    const digits = currencyDigits(currency);
    if (digits == null) throw new Error(`Unknown currency ${currency}`);
    const value = typeof minor === 'bigint' ? minor : BigInt(minor);
    const neg = value < ZERO;
    const abs = neg ? -value : value;
    if (digits === 0) return `${neg ? '-' : ''}${abs.toString()}`;
    const scale = pow10(digits);
    const whole = abs / scale;
    const frac = (abs % scale).toString().padStart(digits, '0');
    return `${neg ? '-' : ''}${whole.toString()}.${frac}`;
}

/** Round half away from zero of quantityMilli * unitMinor / 1000. */
export function lineAmount(quantityMilli: bigint | number, unitMinor: bigint | number): bigint {
    const q = typeof quantityMilli === 'bigint' ? quantityMilli : BigInt(quantityMilli);
    const u = typeof unitMinor === 'bigint' ? unitMinor : BigInt(unitMinor);
    const product = q * u;
    const half = product >= ZERO ? FIVE_HUNDRED : -FIVE_HUNDRED;
    return (product + half) / ONE_THOUSAND;
}

export type DiscountInput =
    | { kind: 'percent'; valueBps: bigint | number }
    | { kind: 'amount'; valueMinor: bigint | number }
    | { kind: null; value?: bigint | number };

export function computeTotals(input: {
    lines: { amount_minor: bigint | number }[];
    discount?: DiscountInput | null;
    taxBps: bigint | number;
}) {
    let subtotal = ZERO;
    for (const line of input.lines) {
        subtotal += typeof line.amount_minor === 'bigint' ? line.amount_minor : BigInt(line.amount_minor);
    }
    let discountMinor = ZERO;
    const discount = input.discount;
    if (discount && discount.kind === 'percent') {
        const bps = typeof discount.valueBps === 'bigint' ? discount.valueBps : BigInt(discount.valueBps);
        const raw = subtotal * bps;
        const half = raw >= ZERO ? FIVE_THOUSAND : -FIVE_THOUSAND;
        discountMinor = (raw + half) / TEN_THOUSAND;
    } else if (discount && discount.kind === 'amount') {
        discountMinor = typeof discount.valueMinor === 'bigint' ? discount.valueMinor : BigInt(discount.valueMinor);
    }
    if (discountMinor < ZERO) discountMinor = ZERO;
    if (discountMinor > subtotal) discountMinor = subtotal;
    const taxable = subtotal - discountMinor;
    const taxBps = typeof input.taxBps === 'bigint' ? input.taxBps : BigInt(input.taxBps);
    const taxRaw = taxable * taxBps;
    const taxHalf = taxRaw >= ZERO ? FIVE_THOUSAND : -FIVE_THOUSAND;
    const taxMinor = (taxRaw + taxHalf) / TEN_THOUSAND;
    const total = taxable + taxMinor;
    return { subtotal, discountMinor, taxable, taxMinor, total };
}

export function formatMoney(minor: bigint | number, currency: string, locale = 'en') {
    const digits = currencyDigits(currency) ?? 2;
    const value = typeof minor === 'bigint' ? minor : BigInt(minor);
    const asNumber = Number(fromMinor(value, currency));
    return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    }).format(asNumber);
}

export function displayStatus(
    invoice: {
        status: InvoiceStatus;
        viewed_at: string | null;
        paid_minor: number | bigint;
        total_minor: number | bigint;
        due_date: string | null;
    },
    today: string
): InvoiceDisplayStatus {
    if (invoice.status === 'draft') return 'draft';
    if (invoice.status === 'void') return 'void';
    if (invoice.status === 'paid') return 'paid';
    const paid = typeof invoice.paid_minor === 'bigint' ? invoice.paid_minor : BigInt(invoice.paid_minor);
    const total = typeof invoice.total_minor === 'bigint' ? invoice.total_minor : BigInt(invoice.total_minor);
    if (paid > ZERO && paid < total) return 'partly_paid';
    if (invoice.due_date && invoice.due_date < today && paid < total) return 'overdue';
    if (invoice.viewed_at) return 'viewed';
    return 'sent';
}

export function clientFacingStatus(status: InvoiceDisplayStatus): string {
    if (status === 'void') return 'Cancelled';
    if (status === 'partly_paid') return 'Partly paid';
    if (status === 'overdue') return 'Overdue';
    if (status === 'paid') return 'Paid';
    if (status === 'viewed' || status === 'sent') return 'Due';
    return 'Draft';
}
