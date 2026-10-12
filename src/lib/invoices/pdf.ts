import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from 'pdf-lib';
import { BOTTOM, MARGIN, PAGE_HEIGHT, PAGE_WIDTH, TOP, fetchLogo, parseColor, toFontSafe, wrap } from '@/lib/pdf';
import { currencyDigits, formatMoney, fromMinor } from './money';

export interface InvoicePdfInput {
    draft?: boolean;
    agency: { name: string; logo_url: string | null; theme_primary_color: string | null };
    number: string | null;
    currency: string;
    issue_date: string | null;
    due_date: string | null;
    from: { name: string; address?: string; tax_id?: string };
    bill_to: { name: string; address?: string; email?: string };
    lines: { description: string; quantity_milli: number; unit_minor: number; amount_minor: number }[];
    subtotal_minor: number;
    discount_minor: number;
    tax_label: string;
    tax_minor: number;
    total_minor: number;
    paid_minor?: number;
    notes?: string | null;
    payment_instructions?: string | null;
    payment_link?: string | null;
    footer_note?: string | null;
}

export { toFontSafe };

/** @deprecated use toFontSafe with a font; kept for tests that import the name. */
export function toWinAnsi(text: string) {
    return text
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\x20-\x7E]/g, '?');
}

export function formatPdfMoney(minor: number, currency: string, font: PDFFont, cache: Map<string, boolean>) {
    const styled = formatMoney(minor, currency, 'en');
    if (toFontSafe(styled, font, cache) === styled) return styled;
    // Same number of decimals as the currency uses ("INR 1,234.50", "JPY 1,234").
    const digits = currencyDigits(currency) ?? 2;
    return new Intl.NumberFormat('en', {
        style: 'currency',
        currency,
        currencyDisplay: 'code',
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    }).format(Number(fromMinor(minor, currency)));
}

type Ctx = {
    doc: PDFDocument;
    page: PDFPage;
    font: PDFFont;
    bold: PDFFont;
    cache: Map<string, boolean>;
    accent: ReturnType<typeof rgb>;
    y: number;
};

function ensureSpace(ctx: Ctx, needed: number, redrawHeader?: () => void) {
    if (ctx.y - needed >= BOTTOM) return;
    ctx.page = ctx.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    ctx.y = TOP;
    redrawHeader?.();
}

function drawTableHeader(ctx: Ctx) {
    ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 4, width: 500, height: 18, color: rgb(0.96, 0.96, 0.96) });
    ctx.page.drawText('Description', { x: MARGIN + 4, y: ctx.y, size: 9, font: ctx.bold });
    ctx.page.drawText('Qty', { x: 340, y: ctx.y, size: 9, font: ctx.bold });
    ctx.page.drawText('Unit', { x: 390, y: ctx.y, size: 9, font: ctx.bold });
    ctx.page.drawText('Amount', { x: 470, y: ctx.y, size: 9, font: ctx.bold });
    ctx.y -= 22;
}

function drawText(ctx: Ctx, text: string, x: number, size: number, font: PDFFont, color = rgb(0.1, 0.1, 0.1)) {
    ctx.page.drawText(toFontSafe(text, font, ctx.cache), { x, y: ctx.y, size, font, color });
}

export async function renderInvoicePdf(input: InvoicePdfInput): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const cache = new Map<string, boolean>();
    const accent = parseColor(input.agency.theme_primary_color);
    const ctx: Ctx = { doc, page, font, bold, cache, accent, y: TOP };

    const logoBytes = await fetchLogo(input.agency.logo_url);
    if (logoBytes) {
        try {
            const isPng = logoBytes[0] === 0x89;
            const image = isPng ? await doc.embedPng(logoBytes) : await doc.embedJpg(logoBytes);
            const size = 40;
            ctx.page.drawImage(image, { x: MARGIN, y: ctx.y - size + 10, width: size, height: size });
        } catch {
            // skip broken logos
        }
    }

    ctx.page.drawRectangle({ x: MARGIN, y: ctx.y + 18, width: 500, height: 3, color: accent });
    drawText(ctx, input.draft ? 'DRAFT' : input.number || 'Invoice', MARGIN + 56, 18, bold);
    ctx.y -= 28;
    drawText(ctx, `Issue ${input.issue_date ?? '-'}  ·  Due ${input.due_date ?? '-'}`, MARGIN + 56, 10, font, rgb(0.4, 0.4, 0.4));

    if (input.draft) {
        ctx.page.drawText('DRAFT', {
            x: 200,
            y: 420,
            size: 72,
            font: bold,
            color: rgb(0.85, 0.85, 0.85),
            rotate: degrees(35),
            opacity: 0.45,
        });
    }

    ctx.y -= 40;
    ctx.y = drawBlock(ctx, MARGIN, ctx.y, 'From', [
        input.from.name,
        input.from.address ?? '',
        input.from.tax_id ? `Tax ID ${input.from.tax_id}` : '',
    ]);
    ctx.y = drawBlock(ctx, 320, ctx.y + 54, 'Bill to', [
        input.bill_to.name,
        input.bill_to.address ?? '',
        input.bill_to.email ?? '',
    ]);
    ctx.y -= 24;

    drawTableHeader(ctx);

    for (const line of input.lines) {
        const descLines = wrap(line.description, font, 9, 270, cache);
        const qtyLabel = (line.quantity_milli / 1000).toFixed(line.quantity_milli % 1000 === 0 ? 0 : 3);
        const blockHeight = descLines.length * 12 + 4;
        ensureSpace(ctx, blockHeight, () => drawTableHeader(ctx));
        for (let i = 0; i < descLines.length; i++) {
            drawText(ctx, descLines[i], MARGIN + 4, 9, font);
            if (i === 0) {
                drawText(ctx, qtyLabel, 340, 9, font);
                drawText(ctx, formatPdfMoney(line.unit_minor, input.currency, font, cache), 390, 9, font);
                drawText(ctx, formatPdfMoney(line.amount_minor, input.currency, font, cache), 470, 9, font);
            }
            ctx.y -= 12;
        }
        ctx.y -= 4;
    }

    ensureSpace(ctx, 100);
    ctx.y -= 10;
    const totals: [string, string][] = [
        ['Subtotal', formatPdfMoney(input.subtotal_minor, input.currency, font, cache)],
    ];
    if (input.discount_minor > 0) totals.push(['Discount', `-${formatPdfMoney(input.discount_minor, input.currency, font, cache)}`]);
    if (input.tax_minor > 0) totals.push([input.tax_label || 'Tax', formatPdfMoney(input.tax_minor, input.currency, font, cache)]);
    totals.push(['Total', formatPdfMoney(input.total_minor, input.currency, font, cache)]);
    if ((input.paid_minor ?? 0) > 0 && (input.paid_minor ?? 0) < input.total_minor) {
        totals.push(['Paid', formatPdfMoney(input.paid_minor ?? 0, input.currency, font, cache)]);
        totals.push(['Balance', formatPdfMoney(input.total_minor - (input.paid_minor ?? 0), input.currency, font, cache)]);
    }
    for (const [label, amount] of totals) {
        ensureSpace(ctx, 16);
        drawText(ctx, label, 360, 10, label === 'Total' ? bold : font);
        drawText(ctx, amount, 470, 10, label === 'Total' ? bold : font);
        ctx.y -= 14;
    }

    ctx.y -= 16;
    if (input.payment_instructions) {
        ensureSpace(ctx, 40);
        drawText(ctx, 'Payment instructions', MARGIN, 10, bold);
        ctx.y -= 14;
        for (const line of wrap(input.payment_instructions, font, 9, 500, cache)) {
            ensureSpace(ctx, 14);
            drawText(ctx, line, MARGIN, 9, font);
            ctx.y -= 12;
        }
    }
    if (input.payment_link) {
        ctx.y -= 6;
        for (const line of wrap(input.payment_link, font, 9, 500, cache)) {
            ensureSpace(ctx, 14);
            drawText(ctx, line, MARGIN, 9, font, accent);
            ctx.y -= 12;
        }
    }
    if (input.notes) {
        ctx.y -= 6;
        ensureSpace(ctx, 40);
        drawText(ctx, 'Notes', MARGIN, 10, bold);
        ctx.y -= 14;
        for (const line of wrap(input.notes, font, 9, 500, cache)) {
            ensureSpace(ctx, 14);
            drawText(ctx, line, MARGIN, 9, font);
            ctx.y -= 12;
        }
    }
    if (input.footer_note) {
        ensureSpace(ctx, 40);
        for (const line of wrap(input.footer_note, font, 8, 500, cache)) {
            ensureSpace(ctx, 12);
            drawText(ctx, line, MARGIN, 8, font, rgb(0.45, 0.45, 0.45));
            ctx.y -= 11;
        }
    }
    ensureSpace(ctx, 20);
    drawText(ctx, 'Powered by OpsVora', MARGIN, 7, font, rgb(0.6, 0.6, 0.6));

    return doc.save();
}

function drawBlock(ctx: Ctx, x: number, y: number, title: string, lines: string[]) {
    ctx.page.drawText(toFontSafe(title, ctx.bold, ctx.cache), { x, y, size: 9, font: ctx.bold, color: rgb(0.45, 0.45, 0.45) });
    let cursor = y - 14;
    for (const line of lines.filter(Boolean)) {
        for (const wrapped of wrap(line, ctx.font, 10, 200, ctx.cache)) {
            ctx.page.drawText(wrapped, { x, y: cursor, size: 10, font: ctx.font });
            cursor -= 12;
        }
    }
    return cursor;
}
