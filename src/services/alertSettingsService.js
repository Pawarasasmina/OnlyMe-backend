import crypto from "node:crypto";
import PlatformSetting from "../models/PlatformSetting.js";
import ApiError from "../utils/ApiError.js";

const KEY = "operational-alerts";
const defaults = Object.freeze({ enabled: true, moderatorChatId: "", ownerChatId: "", reportSpikeThreshold: 10, reportSpikeMinutes: 10, chargebackSpikeThreshold: 5, chargebackSpikeMinutes: 30, payoutFailureThreshold: 1, emailFallback: true });
function encryptionKey() {
  const value = process.env.ALERT_SETTINGS_ENCRYPTION_KEY || process.env.BANK_DETAILS_ENCRYPTION_KEY || "";
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new ApiError(503, "Alert credential encryption is not configured");
  return Buffer.from(value, "hex");
}
function encrypt(value) {
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64")).join(".");
}
function decrypt(value) {
  if (!value) return "";
  const [iv, tag, encrypted] = value.split(".").map((part) => Buffer.from(part, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
export async function alertSettings({ secret = false } = {}) {
  const row = await PlatformSetting.findOne({ key: KEY }).lean(); const value = { ...defaults, ...(row?.value || {}) };
  const token = value.encryptedBotToken ? decrypt(value.encryptedBotToken) : process.env.MODERATION_TELEGRAM_BOT_TOKEN || "";
  const result = { ...value, moderatorChatId: value.moderatorChatId || process.env.MODERATION_TELEGRAM_CHAT_ID || "", ownerChatId: value.ownerChatId || process.env.OWNER_TELEGRAM_CHAT_ID || "", tokenConfigured: Boolean(token) };
  delete result.encryptedBotToken;
  if (secret) result.botToken = token;
  return result;
}
export async function saveAlertSettings(input, adminId) {
  const currentRow = await PlatformSetting.findOne({ key: KEY }).lean(); const current = { ...defaults, ...(currentRow?.value || {}) };
  const next = {
    ...current,
    enabled: input.enabled !== false, emailFallback: input.emailFallback !== false,
    moderatorChatId: String(input.moderatorChatId || "").trim().slice(0, 80), ownerChatId: String(input.ownerChatId || "").trim().slice(0, 80),
    reportSpikeThreshold: Math.min(1000, Math.max(2, Number(input.reportSpikeThreshold) || defaults.reportSpikeThreshold)), reportSpikeMinutes: Math.min(1440, Math.max(1, Number(input.reportSpikeMinutes) || defaults.reportSpikeMinutes)),
    chargebackSpikeThreshold: Math.min(1000, Math.max(2, Number(input.chargebackSpikeThreshold) || defaults.chargebackSpikeThreshold)), chargebackSpikeMinutes: Math.min(1440, Math.max(1, Number(input.chargebackSpikeMinutes) || defaults.chargebackSpikeMinutes)),
    payoutFailureThreshold: Math.min(1000, Math.max(1, Number(input.payoutFailureThreshold) || defaults.payoutFailureThreshold)),
  };
  if (String(input.botToken || "").trim()) next.encryptedBotToken = encrypt(String(input.botToken).trim());
  else if (input.clearBotToken === true) next.encryptedBotToken = "";
  await PlatformSetting.findOneAndUpdate({ key: KEY }, { $set: { value: next, updatedBy: adminId } }, { upsert: true });
  return alertSettings();
}
export function telegramButtonUrl(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol) || hostname === 'localhost' || hostname === '::1' || /^127\./.test(hostname)) return '';
    return url.toString();
  } catch { return ''; }
}
export async function sendTelegram({ buttonText = "", buttonUrl = "", chatId, text }) {
  const settings = await alertSettings({ secret: true });
  if (!settings.enabled || !settings.botToken || !chatId) throw new ApiError(503, "Telegram alerts are not fully configured");
  const safeButtonUrl = telegramButtonUrl(buttonUrl);
  const replyMarkup = safeButtonUrl ? { inline_keyboard: [[{ text: buttonText || "Open", url: safeButtonUrl }]] } : undefined;
  const response = await fetch(`https://api.telegram.org/bot${settings.botToken}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10000), body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.description || `Telegram rejected alert (${response.status})`);
  return String(payload.result?.message_id || "");
}
