import nodemailer from "nodemailer";
import { emailDeliveryConfigured, sendEmail } from "./emailService.js";
import User from "../models/User.js";
export const monitoringMailAdapters = { emailDeliveryConfigured, sendEmail };
export async function monitoringRecipients() {
  const users = await User.find({ role: "admin", status: "active", $or: [{ adminRole: { $in: ["MAIN_ADMIN", "MODERATOR"] } }, { adminRole: null }] }).select("email").lean();
  return [...new Set(users.map((user) => String(user.email || "").trim().toLowerCase()).filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
}
export const monitoringMailProvider = () => monitoringMailAdapters.emailDeliveryConfigured() ? "resend" : process.env.MONITOR_SMTP_HOST && process.env.MONITOR_FROM_EMAIL ? "smtp" : null;
export const monitoringMailConfigured = () => Boolean(monitoringMailProvider());
let transport;
export async function sendMonitoringMail({ recipient, subject, text, key }) {
  if (!monitoringMailConfigured()) return false;
  if (monitoringMailProvider() === "resend") {
    const result = await monitoringMailAdapters.sendEmail({ to: recipient, subject, text, idempotencyKey: key ? `monitoring-${key}` : undefined });
    if (!result.delivered || !result.id) throw new Error("Resend did not acknowledge the monitoring email");
    return true;
  }
  transport ||= nodemailer.createTransport({ host: process.env.MONITOR_SMTP_HOST, port: Number(process.env.MONITOR_SMTP_PORT || 587), secure: process.env.MONITOR_SMTP_SECURE === "true", requireTLS: process.env.MONITOR_SMTP_SECURE !== "true", ...(process.env.MONITOR_SMTP_USER ? { auth: { user: process.env.MONITOR_SMTP_USER, pass: process.env.MONITOR_SMTP_PASSWORD } } : {}), connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000 });
  const result = await transport.sendMail({ from: process.env.MONITOR_FROM_EMAIL, to: recipient, subject, text, disableFileAccess: true, disableUrlAccess: true });
  if (!result.accepted?.some((address) => String(address).toLowerCase() === recipient.toLowerCase()) || result.rejected?.length) throw new Error("SMTP did not accept the monitoring recipient");
  return true;
}
