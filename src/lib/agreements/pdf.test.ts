import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { deviceSummary, inspectUploadedPdf, renderAgreementPdf, sealAgreementPdf, sha256Hex } from './pdf';

const agency = { name: 'Acme Studio', logo_url: null, theme_primary_color: '#F59E0B' };

const longBody = Array.from({ length: 60 }, (_, i) =>
    i % 5 === 0
        ? `# Section ${i + 1}`
        : i % 5 === 1
            ? `- Bullet ${i + 1} covering a point about the arrangement between both sides`
            : `Clause ${i + 1}. Café résumé déjà vu, with a long sentence that has to wrap more than once across the width of the page to prove the layout holds.`
).join('\n\n');

async function sourcePdf() {
    return renderAgreementPdf({ agency, title: 'Service agreement: Acmé', body: longBody, reference: 'AGR-7K3QX9' });
}

/** 1x1 transparent PNG. */
const PNG = new Uint8Array(
    Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
        'base64'
    )
);

describe('sha256Hex', () => {
    it('is the standard hex digest', () => {
        expect(sha256Hex(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });
});

describe('renderAgreementPdf', () => {
    it('renders accents and long bodies across pages', async () => {
        const bytes = await sourcePdf();
        expect(bytes[0]).toBe(0x25);
        const loaded = await PDFDocument.load(bytes);
        expect(loaded.getPageCount()).toBeGreaterThan(1);
    });

    it('renders a preview watermark without throwing', async () => {
        const bytes = await renderAgreementPdf({ agency, title: 'Offer', body: 'Hello', reference: 'AGR-1', preview: true });
        expect(bytes.byteLength).toBeGreaterThan(500);
    });
});

describe('sealAgreementPdf', () => {
    const signature = {
        typed_name: 'Priya Sharma',
        method: 'typed' as const,
        signer_email: 'priya@example.com',
        document_hash: 'abc123',
        ip: '203.0.113.9',
        user_agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36',
        code_verified: true,
        signed_at: '2026-10-02T14:03:00.000Z',
    };
    const agreement = {
        reference: 'AGR-7K3QX9',
        title: 'Service agreement: Acmé',
        kind: 'client_contract',
        recipient_name: 'Priya Sharma',
        recipient_email: 'priya@example.com',
        source_hash: 'abc123',
        agency_signer_name: 'Jane Doe',
        agency_signer_title: 'Director',
        agency_signed_at: '2026-10-02T13:00:00.000Z',
    };
    const events = [
        { kind: 'sent' as const, created_at: '2026-10-02T13:00:00.000Z' },
        { kind: 'viewed' as const, created_at: '2026-10-02T13:40:00.000Z' },
        { kind: 'code_verified' as const, created_at: '2026-10-02T14:01:00.000Z' },
        { kind: 'signed' as const, created_at: '2026-10-02T14:03:00.000Z' },
    ];

    it('appends a certificate page to a multi-page source', async () => {
        const source = await sourcePdf();
        const before = (await PDFDocument.load(source)).getPageCount();
        const sealed = await sealAgreementPdf({ sourcePdfBytes: source, agreement, agency, signature, events, timeZone: 'Asia/Kolkata' });
        const after = await PDFDocument.load(sealed);
        expect(after.getPageCount()).toBe(before + 1);
        expect(sha256Hex(sealed)).not.toBe(sha256Hex(source));
    });

    it('embeds a drawn signature image', async () => {
        const source = await renderAgreementPdf({ agency, title: 'NDA', body: 'Short body', reference: 'AGR-2' });
        const sealed = await sealAgreementPdf({
            sourcePdfBytes: source,
            agreement: { ...agreement, agency_signer_name: null, agency_signer_title: null, agency_signed_at: null },
            agency,
            signature: { ...signature, method: 'drawn' },
            signatureImage: PNG,
            events,
            timeZone: null,
        });
        expect((await PDFDocument.load(sealed)).getPageCount()).toBeGreaterThan(1);
    });

    it('seals an uploaded PDF too', async () => {
        const upload = await PDFDocument.create();
        upload.addPage([595, 842]);
        upload.addPage([595, 842]);
        const bytes = await upload.save();
        const sealed = await sealAgreementPdf({ sourcePdfBytes: bytes, agreement, agency, signature, events });
        expect((await PDFDocument.load(sealed)).getPageCount()).toBe(3);
    });
});

describe('inspectUploadedPdf', () => {
    it('accepts a normal PDF and counts its pages', async () => {
        const doc = await PDFDocument.create();
        doc.addPage();
        doc.addPage();
        const result = await inspectUploadedPdf(await doc.save());
        expect(result).toEqual({ ok: true, pages: 2 });
    });

    it('refuses a file that is not a PDF', async () => {
        const result = await inspectUploadedPdf(new Uint8Array(Buffer.from('not a pdf at all')));
        expect(result).toEqual({ ok: false, error: 'That file is not a PDF.' });
    });

    it('refuses a PDF with too many pages', async () => {
        const doc = await PDFDocument.create();
        for (let i = 0; i < 51; i++) doc.addPage();
        expect(await inspectUploadedPdf(await doc.save())).toMatchObject({ ok: false });
    });
});

describe('deviceSummary', () => {
    it('reads browser and OS, and never leaks the raw string', () => {
        expect(deviceSummary('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1')).toBe('Safari on iOS');
        expect(deviceSummary('Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36')).toBe('Chrome on Windows');
        expect(deviceSummary(null)).toBe('Unknown device');
    });
});
