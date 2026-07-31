import nodemailer from "nodemailer";
import { env } from "../config/env.js";

let transport;

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getTransport() {
  if (!env.smtpHost) {
    return null;
  }

  if (!transport) {
    transport = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpSecure,
      auth: env.smtpUser && env.smtpPass ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
    });
  }

  return transport;
}

export async function sendEmail({ to, subject, text, html }) {
  if (!to || !subject || (!text && !html)) {
    throw new Error("Email recipient, subject, and body are required");
  }

  const smtpTransport = getTransport();

  if (!smtpTransport) {
    if (env.nodeEnv === "production") {
      throw new Error("SMTP settings are not configured");
    }

    console.info(`Email delivery skipped because SMTP is not configured. Intended recipient: ${to}`);
    return {
      queued: false,
      provider: "development",
    };
  }

  const info = await smtpTransport.sendMail({
    from: env.emailFrom,
    to,
    subject,
    text,
    html,
  });

  return {
    queued: true,
    provider: "smtp",
    messageId: info.messageId,
  };
}

export function buildResetPasswordEmail({ name, resetUrl }) {
  const safeName = escapeHtml(name || "there");
  const safeResetUrl = escapeHtml(resetUrl);

  const text = [
    `Hello ${name || "there"},`,
    "",
    "We received a request to reset your password.",
    "",
    `Reset Password: ${resetUrl}`,
    "",
    "This link expires in 1 hour.",
    "",
    "If you didn't request this, please ignore this email.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Reset your OnlyMe password</title>
  </head>
  <body style="margin:0;background:#f6f7fb;color:#111827;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7fb;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td style="padding:28px 28px 12px;">
                <p style="margin:0;color:#f97316;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">OnlyMe</p>
                <h1 style="margin:12px 0 0;color:#111827;font-size:26px;line-height:1.25;">Reset your password</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 28px 28px;color:#374151;font-size:16px;line-height:1.6;">
                <p style="margin:0 0 16px;">Hello ${safeName},</p>
                <p style="margin:0 0 22px;">We received a request to reset your password.</p>
                <p style="margin:0 0 24px;">
                  <a href="${safeResetUrl}" style="display:inline-block;border-radius:999px;background:#f97316;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:13px 22px;">Reset Password</a>
                </p>
                <p style="margin:0 0 8px;">Or open this link in your browser:</p>
                <p style="margin:0 0 22px;word-break:break-all;">
                  <a href="${safeResetUrl}" style="color:#2563eb;text-decoration:underline;">${safeResetUrl}</a>
                </p>
                <p style="margin:0 0 16px;font-weight:700;color:#111827;">This link expires in 1 hour.</p>
                <p style="margin:0;color:#6b7280;">If you didn't request this, please ignore this email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    subject: "Reset your OnlyMe password",
    text,
    html,
  };
}

export function sendResetPasswordEmail({ to, name, resetUrl }) {
  if (!env.smtpHost && env.nodeEnv !== "production") {
    console.info(`Development reset password link for ${to}: ${resetUrl}`);
  }

  const email = buildResetPasswordEmail({ name, resetUrl });
  return sendEmail({
    to,
    ...email,
  });
}
