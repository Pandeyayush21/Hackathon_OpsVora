import { getResend, getResendClient } from './resend';

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

export async function sendNotificationEmail(input: {
    to: string;
    agency: { name: string; slug: string; logo_url: string | null; theme_primary_color: string | null };
    title: string;
    preview?: string | null;
    link: string;
}): Promise<boolean> {
    try {
        const href = input.link.startsWith('http') ? input.link : `${appUrl()}${input.link}`;
        const color = brandColor(input.agency.theme_primary_color);
        const html = shell({
            logoUrl: input.agency.logo_url,
            body: `<p style="margin:0 0 12px;font-size:18px;font-weight:600;color:#18181B;">${esc(input.title)}</p>
    ${input.preview ? `<p style="margin:0 0 16px;font-size:14px;line-height:22px;color:#71717A;">${esc(input.preview)}</p>` : ''}
    <p style="margin:24px 0 0;"><a href="${esc(href)}" style="display:inline-block;background:${color};color:#18181B;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px;">Open</a></p>`,
        });
        const from = process.env.RESEND_FROM_EMAIL || 'OpsVora <onboarding@resend.dev>';
        const { error } = await mailer().emails.send({
            from,
            to: [input.to],
            subject: `${input.agency.name}: ${input.title}`,
            html,
        });
        if (error) throw new Error(error.message);
        return true;
    } catch (err) {
        console.error('[email] notification failed:', err);
        return false;
    }
}

export async function sendDigestEmail(input: {
    to: string;
    agency: { name: string; slug: string; logo_url: string | null; theme_primary_color: string | null };
    items: Array<{ title: string; category: string }>;
}): Promise<boolean> {
    try {
        const color = brandColor(input.agency.theme_primary_color);
        const list = input.items
            .slice(0, 40)
            .map((i) => `<li style="margin:0 0 8px;font-size:14px;color:#3F3F46;">${esc(i.title)}</li>`)
            .join('');
        const html = shell({
            logoUrl: input.agency.logo_url,
            body: `<p style="margin:0 0 12px;font-size:18px;font-weight:600;color:#18181B;">Your daily digest</p>
    <p style="margin:0 0 16px;font-size:14px;color:#71717A;">${input.items.length} update${input.items.length === 1 ? '' : 's'} from ${esc(input.agency.name)}</p>
    <ul style="margin:0;padding-left:18px;">${list}</ul>
    <p style="margin:24px 0 0;"><a href="${esc(`${appUrl()}/agency/${input.agency.slug}`)}" style="display:inline-block;background:${color};color:#18181B;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px;">Open workspace</a></p>`,
        });
        const from = process.env.RESEND_FROM_EMAIL || 'OpsVora <onboarding@resend.dev>';
        const { error } = await mailer().emails.send({
            from,
            to: [input.to],
            subject: `${input.agency.name}: Daily digest (${input.items.length})`,
            html,
        });
        if (error) throw new Error(error.message);
        return true;
    } catch (err) {
        console.error('[email] digest failed:', err);
        return false;
    }
}
