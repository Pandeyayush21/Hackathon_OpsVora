/**
 * Generic PDF building blocks shared by invoices and agreements: A4 layout constants,
 * font-safe text, wrapping that also breaks over-wide words, and a logo fetch limited to
 * the Supabase host.
 */
import { rgb, type PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';

export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;
export const MARGIN = 48;
export const BOTTOM = 72;
/** First baseline on a fresh page. */
export const TOP = 780;
export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

export const DEFAULT_ACCENT = rgb(0.96, 0.62, 0.04);

export function parseColor(value: string | null) {
    if (!value || !/^#[0-9A-Fa-f]{6}$/.test(value)) return DEFAULT_ACCENT;
    const n = parseInt(value.slice(1), 16);
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Keep characters the font can encode; replace the rest with ?. */
export function toFontSafe(text: string, font: PDFFont, cache: Map<string, boolean>) {
    let out = '';
    for (const ch of text) {
        let ok = cache.get(ch);
        if (ok == null) {
            try {
                font.encodeText(ch);
                ok = true;
            } catch {
                ok = false;
            }
            cache.set(ch, ok);
        }
        out += ok ? ch : '?';
    }
    return out;
}

export function wrap(text: string, font: PDFFont, size: number, maxWidth: number, cache: Map<string, boolean>) {
    const words = toFontSafe(text, font, cache).split(/\s+/);
    const lines: string[] = [];
    let current = '';
    // Break words wider than the column (long URLs, IBANs) into chunks that fit.
    const pieces: string[] = [];
    for (const word of words) {
        if (font.widthOfTextAtSize(word, size) <= maxWidth) {
            pieces.push(word);
            continue;
        }
        let chunk = '';
        for (const ch of word) {
            if (chunk && font.widthOfTextAtSize(chunk + ch, size) > maxWidth) {
                pieces.push(chunk);
                chunk = ch;
            } else chunk += ch;
        }
        if (chunk) pieces.push(chunk);
    }
    for (const word of pieces) {
        const next = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > maxWidth && current) {
            lines.push(current);
            current = word;
        } else current = next;
    }
    if (current) lines.push(current);
    return lines.length ? lines : [''];
}

export async function fetchLogo(url: string | null) {
    if (!url) return null;
    try {
        const allowedHost = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host : null;
        const host = new URL(url).host;
        if (!allowedHost || host !== allowedHost) return null;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        try {
            const res = await fetch(url, { signal: controller.signal });
            if (!res.ok) return null;
            return new Uint8Array(await res.arrayBuffer());
        } finally {
            clearTimeout(timer);
        }
    } catch {
        return null;
    }
}

/** Draw a logo at the top left, ignoring anything that fails to embed. */
export async function drawLogo(doc: PDFDocument, page: PDFPage, url: string | null, x: number, y: number, size = 40) {
    const bytes = await fetchLogo(url);
    if (!bytes) return false;
    try {
        const image = bytes[0] === 0x89 ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        page.drawImage(image, { x, y, width: size, height: size });
        return true;
    } catch {
        return false;
    }
}

export interface PdfCursor {
    doc: PDFDocument;
    page: PDFPage;
    font: PDFFont;
    bold: PDFFont;
    cache: Map<string, boolean>;
    y: number;
}

/** Move to a new page when `needed` points no longer fit above the bottom margin. */
export function ensureSpace(ctx: PdfCursor, needed: number, onNewPage?: () => void) {
    if (ctx.y - needed >= BOTTOM) return false;
    ctx.page = ctx.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    ctx.y = TOP;
    onNewPage?.();
    return true;
}
