import { getResend, getResendClient } from './resend';

function mailer() {
    return process.env.RESEND_CLIENT_API_KEY ? getResendClient() : getResend();
}

function esc(value: string) {
    return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export async function sendClientInviteEmail(input: {
    to: string;
    agencyName: string;
    agencyLogoUrl: string | null;
    brandColor: string | null;
    inviterName: string;
    clientName: string;
    link: string;
    expiresAt: string;
}) {
    const color = input.brandColor && /^#[0-9A-Fa-f]{6}$/.test(input.brandColor) ? input.brandColor : '#F59E0B';
    const from = process.env.RESEND_FROM_EMAIL || 'OpsVora <onboarding@resend.dev>';
    const who = input.inviterName || input.agencyName;
    const logo = input.agencyLogoUrl
        ? `<img src="${esc(input.agencyLogoUrl)}" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border-radius:10px;object-fit:contain;">`
        : '';
    const { error } = await mailer().emails.send({
        from,
        to: [input.to],
        subject: `${input.agencyName} invited you to your client portal`,
        html: `<!DOCTYPE html>
<html><body style="margin:0;background:#F3F2EE;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:40px 20px;">
  <div style="margin-bottom:20px;">${logo}</div>
  <div style="background:#fff;border:1px solid #E7E6E1;border-radius:20px;padding:36px;">
    <p style="margin:0 0 16px;font-size:16px;line-height:26px;color:#3F3F46;">Hi,</p>
    <p style="margin:0 0 16px;font-size:16px;line-height:26px;color:#3F3F46;">${esc(who)} at ${esc(input.agencyName)} set up a portal for ${esc(input.clientName)}. You can see the work they share with you there.</p>
    <p style="margin:24px 0;"><a href="${esc(input.link)}" style="display:inline-block;background:${color};color:#18181B;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px;">Open your portal</a></p>
    <p style="margin:0;font-size:14px;line-height:22px;color:#71717A;">The link expires on ${esc(new Date(input.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }))}. If you were not expecting this, you can ignore it.</p>
  </div>
  <p style="margin:20px 0 0;text-align:center;font-size:12px;color:#A1A1AA;">Powered by OpsVora</p>
</div>
</body></html>`,
    });
    if (error) throw new Error(error.message);
}
