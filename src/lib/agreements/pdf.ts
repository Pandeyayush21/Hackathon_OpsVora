/**
 * Agreement PDFs. `renderAgreementPdf` turns a rendered template into a branded document.
 * `sealAgreementPdf` stamps every page of the signed document and appends a signature
 * certificate, so the sealed copy proves what was signed, by whom and when.
 */
import { createHash } from 'crypto';
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import {
    BOTTOM,
    CONTENT_WIDTH,
    MARGIN,
    PAGE_HEIGHT,
    PAGE_WIDTH,
    TOP,
    drawLogo,
    parseColor,
    toFontSafe,
    wrap,
} from '@/lib/pdf';
import type { AgreementEvent, AgreementSignature } from '@/lib/types/database';

export const CONSENT_TEXT =
    'I agree that typing my name and signing here is my signature on this document, and that it has the same effect as signing on paper.';

export const LEGAL_NOTE =
    'This is a simple electronic signature with a consent record and an audit trail. Some documents or places may need a different kind of signature.';

export function sha256Hex(bytes: Uint8Array | Buffer): string {
    return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

export interface AgreementBrand {
    name: string;
    logo_url: string | null;
    theme_primary_color: string | null;
}

interface Cursor {
    doc: PDFDocument;
    page: PDFPage;
    font: PDFFont;
    bold: PDFFont;
    cache: Map<string, boolean>;
    y: number;
}

const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.45, 0.45, 0.45);

function newPage(ctx: Cursor) {
    ctx.page = ctx.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    ctx.y = TOP;
}

function room(ctx: Cursor, needed: number) {
    if (ctx.y - needed < BOTTOM) newPage(ctx);
}

function line(ctx: Cursor, text: string, size: number, font: PDFFont, color = INK, gap = 4) {
    room(ctx, size + gap);
    ctx.page.drawText(toFontSafe(text, font, ctx.cache), { x: MARGIN, y: ctx.y, size, font, color });
    ctx.y -= size + gap;
}

function paragraph(ctx: Cursor, text: string, size: number, font: PDFFont, color = INK, width = CONTENT_WIDTH) {
    for (const wrapped of wrap(text, font, size, width, ctx.cache)) {
        room(ctx, size + 4);
        ctx.page.drawText(wrapped, { x: MARGIN, y: ctx.y, size, font, color });
        ctx.y -= size + 4;
    }
}

/** Body text: `# ` starts a heading, `- ` a bullet, a blank line a gap, everything else a paragraph. */
function drawBody(ctx: Cursor, body: string) {
    for (const raw of body.split('\n')) {
        const text = raw.trimEnd();
        if (!text.trim()) {
            ctx.y -= 8;
            continue;
        }
        if (text.startsWith('# ')) {
            ctx.y -= 8;
            room(ctx, 30);
            line(ctx, text.slice(2).trim(), 13, ctx.bold, INK, 8);
            continue;
        }
        if (text.startsWith('- ')) {
            const lines = wrap(text.slice(2).trim(), ctx.font, 10, CONTENT_WIDTH - 14, ctx.cache);
            for (let i = 0; i < lines.length; i++) {
                room(ctx, 15);
                if (i === 0) ctx.page.drawText('-', { x: MARGIN, y: ctx.y, size: 10, font: ctx.font, color: MUTED });
                ctx.page.drawText(lines[i], { x: MARGIN + 14, y: ctx.y, size: 10, font: ctx.font, color: INK });
                ctx.y -= 15;
            }
            continue;
        }
        paragraph(ctx, text, 10, ctx.font);
        ctx.y -= 3;
    }
}

function stampFooters(doc: PDFDocument, font: PDFFont, cache: Map<string, boolean>, text: string) {
    const pages = doc.getPages();
    for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const { width } = page.getSize();
        page.drawText(toFontSafe(text, font, cache), { x: MARGIN, y: 34, size: 7, font, color: MUTED });
        const label = `Page ${i + 1} of ${pages.length}`;
        page.drawText(label, { x: width - MARGIN - font.widthOfTextAtSize(label, 7), y: 34, size: 7, font, color: MUTED });
    }
}

export interface RenderAgreementInput {
    agency: AgreementBrand;
    title: string;
    body: string;
    reference: string;
    /** Draws a diagonal PREVIEW watermark. Preview PDFs are never stored. */
    preview?: boolean;
}

export async function renderAgreementPdf(input: RenderAgreementInput): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const cache = new Map<string, boolean>();
    const accent = parseColor(input.agency.theme_primary_color);
    const ctx: Cursor = { doc, page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]), font, bold, cache, y: TOP };

    const hasLogo = await drawLogo(doc, ctx.page, input.agency.logo_url, MARGIN, ctx.y - 30, 40);
    ctx.page.drawRectangle({ x: MARGIN, y: ctx.y + 18, width: CONTENT_WIDTH, height: 3, color: accent });
    const headerX = hasLogo ? MARGIN + 56 : MARGIN;
    ctx.page.drawText(toFontSafe(input.agency.name, bold, cache), { x: headerX, y: ctx.y, size: 12, font: bold, color: INK });
    ctx.page.drawText(toFontSafe(`Ref ${input.reference}`, font, cache), { x: headerX, y: ctx.y - 14, size: 8, font, color: MUTED });
    ctx.y -= 56;

    for (const wrapped of wrap(input.title, bold, 18, CONTENT_WIDTH, cache)) {
        room(ctx, 26);
        ctx.page.drawText(wrapped, { x: MARGIN, y: ctx.y, size: 18, font: bold, color: INK });
        ctx.y -= 24;
    }
    ctx.y -= 10;

    drawBody(ctx, input.body);

    ctx.y -= 14;
    paragraph(ctx, LEGAL_NOTE, 7.5, font, MUTED);

    if (input.preview) {
        for (const page of doc.getPages()) {
            page.drawText('PREVIEW', {
                x: 150,
                y: 400,
                size: 64,
                font: bold,
                color: rgb(0.85, 0.85, 0.85),
                rotate: degrees(35),
                opacity: 0.45,
            });
        }
    }

    stampFooters(doc, font, cache, input.preview ? `PREVIEW, not for signature. Ref ${input.reference}` : `Ref ${input.reference}`);
    return doc.save();
}

export interface SealInput {
    sourcePdfBytes: Uint8Array;
    agreement: {
        reference: string;
        title: string;
        kind: string;
        recipient_name: string;
        recipient_email: string;
        source_hash: string | null;
        agency_signer_name: string | null;
        agency_signer_title: string | null;
        agency_signed_at: string | null;
    };
    agency: AgreementBrand;
    signature: Pick<
        AgreementSignature,
        'typed_name' | 'method' | 'signer_email' | 'document_hash' | 'ip' | 'user_agent' | 'code_verified' | 'signed_at'
    >;
    /** Drawn signature PNG bytes, if the signer drew one. */
    signatureImage?: Uint8Array | null;
    events: Pick<AgreementEvent, 'kind' | 'created_at'>[];
    /** IANA timezone used for the second, human-readable timestamp. */
    timeZone?: string | null;
}

const EVENT_LABEL: Record<string, string> = {
    created: 'Created',
    sent: 'Sent to recipient',
    resent: 'Resent',
    viewed: 'Opened by recipient',
    code_sent: 'Email code sent',
    code_verified: 'Email code verified',
    signed: 'Signed',
    declined: 'Declined',
    voided: 'Withdrawn',
    expired: 'Expired',
    sealed: 'Signed copy created',
    downloaded: 'Downloaded',
    email_failed: 'Email could not be delivered',
};

function utc(iso: string) {
    return `${new Date(iso).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function local(iso: string, timeZone: string | null | undefined) {
    if (!timeZone) return null;
    try {
        return `${new Intl.DateTimeFormat('en-GB', {
            timeZone,
            dateStyle: 'medium',
            timeStyle: 'short',
        }).format(new Date(iso))} (${timeZone})`;
    } catch {
        return null;
    }
}

/** A short, readable summary of the signer's device instead of the raw user agent. */
export function deviceSummary(userAgent: string | null): string {
    if (!userAgent) return 'Unknown device';
    const os = /Windows/i.test(userAgent)
        ? 'Windows'
        : /Android/i.test(userAgent)
            ? 'Android'
            : /iPhone|iPad|iOS/i.test(userAgent)
                ? 'iOS'
                : /Mac OS X|Macintosh/i.test(userAgent)
                    ? 'macOS'
                    : /Linux/i.test(userAgent)
                        ? 'Linux'
                        : 'Unknown OS';
    const browser = /Edg\//i.test(userAgent)
        ? 'Edge'
        : /OPR\//i.test(userAgent)
            ? 'Opera'
            : /Chrome\//i.test(userAgent)
                ? 'Chrome'
                : /Firefox\//i.test(userAgent)
                    ? 'Firefox'
                    : /Safari\//i.test(userAgent)
                        ? 'Safari'
                        : 'Unknown browser';
    return `${browser} on ${os}`;
}

export async function sealAgreementPdf(input: SealInput): Promise<Uint8Array> {
    const doc = await PDFDocument.load(input.sourcePdfBytes, { ignoreEncryption: false });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const cache = new Map<string, boolean>();

    // Every page of the original says where to find the proof.
    for (const page of doc.getPages()) {
        const text = `Signed electronically. Certificate on last page. Ref ${input.agreement.reference}`;
        page.drawText(toFontSafe(text, font, cache), { x: MARGIN, y: 20, size: 7, font, color: MUTED });
    }

    const ctx: Cursor = { doc, page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]), font, bold, cache, y: TOP };
    const accent = parseColor(input.agency.theme_primary_color);
    ctx.page.drawRectangle({ x: MARGIN, y: ctx.y + 18, width: CONTENT_WIDTH, height: 3, color: accent });
    line(ctx, 'Signature certificate', 18, bold, INK, 14);
    paragraph(ctx, `${input.agreement.title} (Ref ${input.agreement.reference})`, 10, font, MUTED);
    ctx.y -= 10;

    const signedUtc = utc(input.signature.signed_at);
    const signedLocal = local(input.signature.signed_at, input.timeZone);
    const rows: [string, string][] = [
        ['Recipient', `${input.agreement.recipient_name} <${input.agreement.recipient_email}>`],
        ['Signed in as', input.signature.signer_email],
        ['Typed name', input.signature.typed_name],
        ['Signature', input.signature.method === 'drawn' ? 'Drawn by hand' : 'Typed'],
        ['Signed at', signedLocal ? `${signedUtc} / ${signedLocal}` : signedUtc],
        ['IP address', input.signature.ip ?? 'Not recorded'],
        ['Device', deviceSummary(input.signature.user_agent)],
        ['Email code verified', input.signature.code_verified ? 'Yes' : 'No'],
        ['Document SHA-256', input.agreement.source_hash ?? input.signature.document_hash],
    ];
    if (input.agreement.agency_signer_name) {
        const title = input.agreement.agency_signer_title ? `, ${input.agreement.agency_signer_title}` : '';
        const when = input.agreement.agency_signed_at ? ` on ${utc(input.agreement.agency_signed_at)}` : '';
        rows.push(['Signed for the agency', `${input.agreement.agency_signer_name}${title}${when}`]);
    }

    for (const [label, value] of rows) {
        room(ctx, 28);
        ctx.page.drawText(toFontSafe(label, bold, cache), { x: MARGIN, y: ctx.y, size: 8.5, font: bold, color: MUTED });
        ctx.y -= 12;
        for (const wrapped of wrap(value, font, 10, CONTENT_WIDTH, cache)) {
            room(ctx, 14);
            ctx.page.drawText(wrapped, { x: MARGIN, y: ctx.y, size: 10, font, color: INK });
            ctx.y -= 13;
        }
        ctx.y -= 5;
    }

    ctx.y -= 6;
    line(ctx, 'Signature', 8.5, bold, MUTED, 10);
    if (input.signature.method === 'drawn' && input.signatureImage?.length) {
        try {
            const image = await doc.embedPng(input.signatureImage);
            const width = Math.min(220, image.width);
            const height = (image.height / image.width) * width;
            room(ctx, height + 10);
            ctx.page.drawImage(image, { x: MARGIN, y: ctx.y - height, width, height });
            ctx.y -= height + 12;
        } catch {
            line(ctx, input.signature.typed_name, 16, bold, INK, 12);
        }
    } else {
        line(ctx, input.signature.typed_name, 16, bold, INK, 12);
    }
    ctx.page.drawRectangle({ x: MARGIN, y: ctx.y + 6, width: 240, height: 0.8, color: MUTED });
    ctx.y -= 10;

    ctx.y -= 8;
    line(ctx, 'Consent', 8.5, bold, MUTED, 10);
    paragraph(ctx, CONSENT_TEXT, 9, font);

    ctx.y -= 12;
    line(ctx, 'Timeline', 8.5, bold, MUTED, 10);
    for (const event of input.events) {
        room(ctx, 14);
        const label = `${utc(event.created_at)}  ${EVENT_LABEL[event.kind] ?? event.kind}`;
        ctx.page.drawText(toFontSafe(label, font, cache), { x: MARGIN, y: ctx.y, size: 9, font, color: INK });
        ctx.y -= 13;
    }

    ctx.y -= 12;
    paragraph(ctx, LEGAL_NOTE, 7.5, font, MUTED);

    stampFooters(doc, font, cache, `Signed electronically. Ref ${input.agreement.reference}`);
    return doc.save();
}

/** Rejects anything that is not an unencrypted PDF we can read and seal later. */
export async function inspectUploadedPdf(bytes: Uint8Array): Promise<{ ok: true; pages: number } | { ok: false; error: string }> {
    const header = Buffer.from(bytes.slice(0, 5)).toString('latin1');
    if (header !== '%PDF-') return { ok: false, error: 'That file is not a PDF.' };
    try {
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
        const pages = doc.getPageCount();
        if (pages < 1) return { ok: false, error: 'That PDF has no pages.' };
        if (pages > 50) return { ok: false, error: 'A document can have at most 50 pages.' };
        return { ok: true, pages };
    } catch {
        return { ok: false, error: 'That PDF could not be read. Password-protected files are not supported.' };
    }
}
