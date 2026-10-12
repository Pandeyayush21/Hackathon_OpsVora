import { getResend, getResendClient } from '@/lib/email/resend';
import { formatMoney } from '@/lib/invoices/money';

function mailer() {
    return process.env.RESEND_CLIENT_API_KEY ? getResendClient() : getResend();
}

function esc(value: string) {
    return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function appUrl() {
    return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function brandColor(value: string | null) {
    return value && /^#[0-9A-Fa-f]{6}$/.test(value) ? value : '#F59E0B';
}

function shell(input: { logoUrl: string | null; body: string }) {
    const logo = input.logoUrl
        ? `<img src="${esc(input.logoUrl)}" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border-radius:10px;object-fit:contain;">`
        : '';
    return `<!DOCTYPE html>
<html><body style="margin:0;background:#F3F2EE;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:40px 20px;">
  <div style="margin-bottom:20px;">${logo}</div>
  <div style="background:#fff;border:1px solid #E7E6E1;border-radius:20px;padding:36px;">
    ${input.body}
  </div>
  <p style="margin:20px 0 0;text-align:center;font-size:12px;color:#A1A1AA;">Powered by OpsVora</p>
</div>
</body></html>`;
}

async function send(input: {
    to: string[];
    subject: string;
    html: string;
    attachments?: { filename: string; content: Buffer }[];
}) {
    if (!input.to.length) return false;
    const from = process.env.RESEND_FROM_EMAIL || 'OpsVora <onboarding@resend.dev>';
    const { error } = await mailer().emails.send({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        attachments: input.attachments?.map((file) => ({ filename: file.filename, content: file.content })),
    });
    if (error) throw new Error(error.message);
    return true;
}

type AgencyBrand = { name: string; slug: string; logo_url: string | null; theme_primary_color: string | null };

export async function sendInvoiceEmail(input: {
    to: string[];
    agency: AgencyBrand;
    number: string;
    totalMinor: number;
    currency: string;
    dueDate: string | null;
    invoiceId: string;
    pdf: Uint8Array;
}): Promise<boolean> {
    try {
        const link = `${appUrl()}/portal/${input.agency.slug}/invoices/${input.invoiceId}`;
        const color = brandColor(input.agency.theme_primary_color);
        const amount = formatMoney(input.totalMinor, input.currency);
        const html = shell({
            logoUrl: input.agency.logo_url,
            body: `<p style="margin:0 0 16px;font-size:16px;line-height:26px;color:#3F3F46;">Invoice ${esc(input.number)} from ${esc(input.agency.name)}.</p>
    <p style="margin:0 0 8px;font-size:18px;font-weight:600;color:#18181B;">${esc(amount)}</p>
    <p style="margin:0 0 16px;font-size:14px;color:#71717A;">Due ${esc(input.dueDate ?? 'on receipt')}</p>
    <p style="margin:24px 0 0;"><a href="${esc(link)}" style="display:inline-block;background:${color};color:#18181B;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px;">View invoice</a></p>`,
        });
        return await send({
            to: input.to,
            subject: `Invoice ${input.number} from ${input.agency.name}`,
            html,
            attachments: [{ filename: `${input.number}.pdf`, content: Buffer.from(input.pdf) }],
        });
    } catch (err) {
        console.error('[email] invoice send failed:', err);
        return false;
    }
}

export async function sendInvoiceReminder(input: {
    to: string[];
    agency: AgencyBrand;
    number: string;
    totalMinor: number;
    currency: string;
    dueDate: string | null;
    invoiceId: string;
    stage: 'due' | 'overdue_7';
}): Promise<boolean> {
    try {
        const link = `${appUrl()}/portal/${input.agency.slug}/invoices/${input.invoiceId}`;
        const color = brandColor(input.agency.theme_primary_color);
        const amount = formatMoney(input.totalMinor, input.currency);
        const headline = input.stage === 'due' ? 'Due today' : 'Overdue';
        const html = shell({
            logoUrl: input.agency.logo_url,
            body: `<p style="margin:0 0 16px;font-size:16px;line-height:26px;color:#3F3F46;">${esc(headline)}: invoice ${esc(input.number)} for ${esc(amount)}.</p>
    <p style="margin:24px 0 0;"><a href="${esc(link)}" style="display:inline-block;background:${color};color:#18181B;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px;">View invoice</a></p>`,
        });
        return await send({
            to: input.to,
            subject: `${headline}: invoice ${input.number} from ${input.agency.name}`,
            html,
        });
    } catch (err) {
        console.error('[email] invoice reminder failed:', err);
        return false;
    }
}

export async function sendPaymentReceipt(input: {
    to: string[];
    agency: AgencyBrand;
    number: string;
    amountMinor: number;
    currency: string;
    invoiceId: string;
}): Promise<boolean> {
    try {
        const link = `${appUrl()}/portal/${input.agency.slug}/invoices/${input.invoiceId}`;
        const color = brandColor(input.agency.theme_primary_color);
        const amount = formatMoney(input.amountMinor, input.currency);
        const html = shell({
            logoUrl: input.agency.logo_url,
            body: `<p style="margin:0 0 16px;font-size:16px;line-height:26px;color:#3F3F46;">We recorded a payment of ${esc(amount)} on invoice ${esc(input.number)}.</p>
    <p style="margin:24px 0 0;"><a href="${esc(link)}" style="display:inline-block;background:${color};color:#18181B;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px;">View invoice</a></p>`,
        });
        return await send({
            to: input.to,
            subject: `Payment received for invoice ${input.number}`,
            html,
        });
    } catch (err) {
        console.error('[email] payment receipt failed:', err);
        return false;
    }
}
