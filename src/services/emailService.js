import { env } from "../config/env.js";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function required(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

export function emailDeliveryConfigured() {
  return Boolean(env.resendApiKey && env.emailFrom);
}

export async function sendEmail({ html, idempotencyKey, subject, text, to }) {
  const recipient = required(to, "Email recipient");
  if (!emailDeliveryConfigured()) return { delivered: false, skipped: true, reason: "EMAIL_NOT_CONFIGURED" };

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.resendApiKey}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify({ from: env.emailFrom, to: [recipient], subject: required(subject, "Email subject"), html, text }),
    signal: AbortSignal.timeout(env.emailTimeoutMs),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Email provider rejected the request (${response.status}): ${payload.message || payload.name || "Unknown error"}`);
  return { delivered: true, id: payload.id, provider: "resend" };
}

export function welcomeEmail({ name, role }) {
  const firstName = String(name || "there").trim().split(/\s+/)[0] || "there";
  const creator = role === "creator";
  const actionUrl = `${env.clientUrl.replace(/\/$/, "")}/${creator ? "onboarding" : "discover"}`;
  const actionLabel = creator ? "Set up your creator profile" : "Start discovering";
  const intro = creator
    ? "Your creator space is ready. Share what you see, build your world, and let the right people find you."
    : "Your space is ready. Discover people, moments, and worlds that feel relevant to you.";
  const text = `Welcome to @seen, ${firstName}!\n\n${intro}\n\n${actionLabel}: ${actionUrl}\n\nWe see you. Every day.\n@seen`;
  const html = `<!doctype html><html><body style="margin:0;background:#06080b;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#06080b;padding:32px 14px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;overflow:hidden;border:1px solid rgba(255,255,255,.1);border-radius:24px;background:#12151b"><tr><td style="padding:34px 34px 18px"><div style="font-size:25px;font-weight:800;letter-spacing:-.6px">@<span style="color:#9ccbff">seen</span></div><div style="margin-top:36px;color:#9ccbff;font-size:12px;font-weight:800;letter-spacing:1.6px;text-transform:uppercase">Welcome to @seen</div><h1 style="margin:10px 0 0;font-size:30px;line-height:1.18;letter-spacing:-.8px">We see you, ${escapeHtml(firstName)}.</h1><p style="margin:18px 0 0;color:rgba(255,255,255,.68);font-size:16px;line-height:1.65">${intro}</p><a href="${actionUrl}" style="display:inline-block;margin-top:28px;border-radius:999px;background:#9ccbff;color:#07101a;padding:14px 22px;font-size:14px;font-weight:800;text-decoration:none">${actionLabel} →</a></td></tr><tr><td style="padding:24px 34px 34px"><div style="height:1px;background:rgba(255,255,255,.08)"></div><p style="margin:22px 0 0;color:rgba(255,255,255,.4);font-size:12px;line-height:1.6">You received this because an @seen account was created with this email address.<br>@seen — We see you. Every day.</p></td></tr></table></td></tr></table></body></html>`;
  return { subject: "Welcome to @seen — we see you", text, html };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

export async function sendWelcomeEmail(user) {
  return sendEmail({
    to: user.email,
    ...welcomeEmail({ name: user.name, role: user.role }),
    idempotencyKey: `welcome-${String(user._id)}`,
  });
}
