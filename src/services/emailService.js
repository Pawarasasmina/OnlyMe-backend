import { env } from "../config/env.js";
import EmailTemplate from "../models/EmailTemplate.js";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const required = (value, label) => { const normalized = String(value || "").trim(); if (!normalized) throw new Error(`${label} is required`); return normalized; };

export function emailDeliveryConfigured() { return Boolean(env.resendApiKey && env.emailFrom); }

export async function sendEmail({ html, idempotencyKey, subject, text, to }) {
  const recipient = required(to, "Email recipient");
  if (!emailDeliveryConfigured()) return { delivered: false, skipped: true, reason: "EMAIL_NOT_CONFIGURED" };
  const response = await fetch(RESEND_ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${env.resendApiKey}`, "Content-Type": "application/json", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) }, body: JSON.stringify({ from: env.emailFrom, to: [recipient], subject: required(subject, "Email subject"), html, text }), signal: AbortSignal.timeout(env.emailTimeoutMs) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Email provider rejected the request (${response.status}): ${payload.message || payload.name || "Unknown error"}`);
  return { delivered: true, id: payload.id, provider: "resend" };
}

export function welcomeEmail({ name, template = {} }) {
  const firstName = String(name || "there").trim().split(/\s+/)[0] || "there";
  const actionUrl = `${env.clientUrl.replace(/\/$/, "")}/discover`;
  const token = (value, fallback) => String(value || fallback).replaceAll("{{firstName}}", firstName);
  const actionLabel = token(template.buttonLabel, "Start discovering");
  const intro = token(template.message, "Your space is ready. Discover people, moments, and worlds that feel relevant to you.");
  const heading = token(template.heading, "We see you, {{firstName}}.");
  const footer = token(template.footer, "@seen — We see you. Every day.");
  const subject = token(template.subject, "Welcome to @seen — we see you");
  const logo = template.logo?.url ? `<img alt="@seen" src="${escapeHtml(template.logo.url)}" style="display:block;max-height:64px;max-width:220px;object-fit:contain">` : `<div style="font-size:25px;font-weight:800">@<span style="color:#9ccbff">seen</span></div>`;
  const text = `${heading}\n\n${intro}\n\n${actionLabel}: ${actionUrl}\n\n${footer}`;
  const html = `<!doctype html><html><body style="margin:0;background:#06080b;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#06080b;padding:32px 14px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;overflow:hidden;border:1px solid rgba(255,255,255,.1);border-radius:24px;background:#12151b"><tr><td style="padding:34px 34px 18px">${logo}<div style="margin-top:36px;color:#9ccbff;font-size:12px;font-weight:800;letter-spacing:1.6px;text-transform:uppercase">Welcome to @seen</div><h1 style="margin:10px 0 0;font-size:30px;line-height:1.18">${escapeHtml(heading)}</h1><p style="margin:18px 0 0;color:rgba(255,255,255,.68);font-size:16px;line-height:1.65">${escapeHtml(intro).replaceAll("\n", "<br>")}</p><a href="${actionUrl}" style="display:inline-block;margin-top:28px;border-radius:999px;background:#9ccbff;color:#07101a;padding:14px 22px;font-size:14px;font-weight:800;text-decoration:none">${escapeHtml(actionLabel)} →</a></td></tr><tr><td style="padding:24px 34px 34px"><div style="height:1px;background:rgba(255,255,255,.08)"></div><p style="margin:22px 0 0;color:rgba(255,255,255,.4);font-size:12px;line-height:1.6">You received this because an @seen account was created with this email address.<br>${escapeHtml(footer).replaceAll("\n", "<br>")}</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

export async function sendWelcomeEmail(user) {
  const template = await EmailTemplate.findOne({ key: "WELCOME" }).lean().catch(() => null);
  return sendEmail({ to: user.email, ...welcomeEmail({ name: user.name, template }), idempotencyKey: `welcome-${String(user._id)}` });
}
