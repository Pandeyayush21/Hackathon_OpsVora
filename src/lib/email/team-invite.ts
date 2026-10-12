import { getResend, getResendClient } from './resend';

function mailer() {
    const key = process.env.RESEND_CLIENT_API_KEY;
    if (key) return getResendClient();
    return getResend();
}

export async function sendTeamInviteEmail(input: {
    to: string;
    name: string;
    agencyName: string;
    role: string;
    link: string;
    brandColor: string | null;
}) {
    const color = input.brandColor && /^#[0-9A-Fa-f]{6}$/.test(input.brandColor) ? input.brandColor : '#F59E0B';
    const who = input.name ? `Hi ${input.name},` : 'Hi,';
    const from = process.env.RESEND_FROM_EMAIL || 'Vora <onboarding@resend.dev>';
    const { error } = await mailer().emails.send({
        from,
        to: [input.to],
        subject: `${input.agencyName} invited you to OpsVora`,
        html: `<!DOCTYPE html>
<html><body style="margin:0;background:#F3F2EE;font-family:Segoe UI,Tahoma,sans-serif;">
<div style="max-width:520px;margin:0 auto;padding:40px 20px;">
  <div style="height:6px;border-radius:999px;background:${color};margin-bottom:28px;"></div>
  <h1 style="margin:0;font-size:22px;color:#18181B;">Join ${escapeHtml(input.agencyName)}</h1>
  <p style="color:#52525B;font-size:15px;line-height:1.5;">${escapeHtml(who)} you have been invited as a ${escapeHtml(input.role)}.</p>
  <p style="margin:28px 0;"><a href="${escapeHtml(input.link)}" style="display:inline-block;background:${color};color:#18181B;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px;">Accept invite</a></p>
  <p style="color:#A1A1AA;font-size:12px;">This link expires in 7 days. If you were not expecting it, you can ignore this email.</p>
</div>
</body></html>`,
    });
    if (error) throw new Error(error.message);
}

function escapeHtml(value: string) {
    return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
