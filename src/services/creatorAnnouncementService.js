import CreatorAnnouncement from "../models/CreatorAnnouncement.js";
import CreatorAnnouncementRecipient from "../models/CreatorAnnouncementRecipient.js";
import CreatorProfile from "../models/CreatorProfile.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import { env } from "../config/env.js";
import { sendEmail } from "./emailService.js";

const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const cleanArray = (value) => Array.isArray(value) ? [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].slice(0, 30) : [];
export function normalizeAudience(input = {}) {
  const date = (value) => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value) : null;
  const throughDate = date(input.joinedTo);
  if (throughDate && /^\d{4}-\d{2}-\d{2}$/.test(String(input.joinedTo))) throughDate.setUTCHours(23, 59, 59, 999);
  return {
    accountTypes: cleanArray(input.accountTypes).filter((v) => ["personal", "creator", "business"].includes(v)),
    approvalStatuses: cleanArray(input.approvalStatuses).filter((v) => ["pending", "approved", "rejected", "suspended"].includes(v)),
    verified: input.verified === true ? true : input.verified === false ? false : null,
    languages: cleanArray(input.languages), countries: cleanArray(input.countries), categories: cleanArray(input.categories),
    joinedFrom: date(input.joinedFrom), joinedTo: throughDate, activeSince: date(input.activeSince),
  };
}

export async function creatorAudienceFilter(raw) {
  const audience = normalizeAudience(raw);
  const filter = { role: { $in: ["fan", "creator"] }, status: "active", deletionRequestedAt: null };
  const creatorClauses = [];
  if (audience.accountTypes.length) creatorClauses.push({ $or: [{ profileAccountType: { $in: audience.accountTypes } }, { profileType: { $in: audience.accountTypes } }] });
  else creatorClauses.push({ $or: [{ profileAccountType: { $in: ["personal", "creator", "business"] } }, { profileType: { $in: ["personal", "creator", "business"] } }, { creatorApprovalStatus: { $ne: null } }] });
  if (audience.approvalStatuses.length) creatorClauses.push({ creatorApprovalStatus: { $in: audience.approvalStatuses } });
  if (audience.verified !== null) creatorClauses.push({ isVerified: audience.verified });
  if (audience.languages.length) creatorClauses.push({ preferredLanguage: { $in: audience.languages } });
  if (audience.joinedFrom || audience.joinedTo) creatorClauses.push({ createdAt: { ...(audience.joinedFrom && { $gte: audience.joinedFrom }), ...(audience.joinedTo && { $lte: audience.joinedTo }) } });
  if (audience.activeSince) creatorClauses.push({ lastSeenAt: { $gte: audience.activeSince } });
  if (audience.countries.length || audience.categories.length) {
    const profileFilter = { ...(audience.countries.length && { country: { $in: audience.countries } }), ...(audience.categories.length && { $or: [{ category: { $in: audience.categories } }, { categories: { $in: audience.categories } }] }) };
    const ids = await CreatorProfile.find(profileFilter).distinct("user");
    creatorClauses.push({ _id: { $in: ids } });
  }
  filter.$and = creatorClauses;
  return { audience, filter };
}

export async function audiencePreview(raw, { page = 1, limit = 50 } = {}) {
  const { audience, filter } = await creatorAudienceFilter(raw);
  const safePage = Math.max(1, Number(page) || 1), safeLimit = Math.min(100, Math.max(10, Number(limit) || 50));
  const [count, recipients] = await Promise.all([User.countDocuments(filter), User.find(filter).select("name username email preferredLanguage creatorApprovalStatus isVerified profileAccountType profileType").sort({ createdAt: -1, _id: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean()]);
  return { audience, count, sample: recipients.map((u) => ({ id: u._id, name: u.name, username: u.username, email: u.email || "", language: u.preferredLanguage, approvalStatus: u.creatorApprovalStatus, verified: u.isVerified, accountType: u.profileAccountType || u.profileType })), pagination: { page: safePage, limit: safeLimit, pages: Math.ceil(count / safeLimit), hasMore: safePage * safeLimit < count } };
}

export function personalizeAnnouncement(value, recipient = {}) {
  const fullName = String(recipient.name || "there").trim() || "there";
  const firstName = fullName.split(/\s+/)[0] || "there";
  const username = String(recipient.username || "creator").trim().replace(/^@/, "") || "creator";
  return String(value || "").replaceAll("{{firstName}}", firstName).replaceAll("{{fullName}}", fullName).replaceAll("{{username}}", username);
}

export function announcementEmail(campaign, recipient) {
  const message = personalizeAnnouncement(campaign.message, recipient);
  const title = personalizeAnnouncement(campaign.title, recipient);
  const url = campaign.actionUrl ? new URL(campaign.actionUrl, env.clientUrl).toString() : "";
  const action = url && campaign.actionLabel ? `<a href="${escapeHtml(url)}" style="display:inline-block;margin-top:24px;border-radius:999px;background:#9ccbff;color:#07101a;padding:13px 20px;font-weight:800;text-decoration:none">${escapeHtml(campaign.actionLabel)}</a>` : "";
  return { subject: title, text: `${title}\n\n${message}${url ? `\n\n${campaign.actionLabel}: ${url}` : ""}\n\n@seen`, html: `<!doctype html><html><body style="margin:0;background:#06080b;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"><div style="max-width:560px;margin:auto;padding:40px 22px"><div style="font-size:25px;font-weight:800">@<span style="color:#9ccbff">seen</span></div><div style="margin-top:28px;border:1px solid rgba(255,255,255,.1);border-radius:24px;background:#12151b;padding:32px"><h1 style="margin:0;font-size:28px">${escapeHtml(title)}</h1><p style="color:rgba(255,255,255,.7);font-size:16px;line-height:1.65;white-space:pre-wrap">${escapeHtml(message)}</p>${action}</div></div></body></html>` };
}

async function processRecipient(campaign, recipient, io) {
  const now = new Date(); const update = { status: "COMPLETED", processedAt: now }; const inc = { processed: 1, pending: -1 };
  if (campaign.channels.includes("IN_APP") && !recipient.inAppDeliveredAt) {
    const title = personalizeAnnouncement(campaign.title, recipient), message = personalizeAnnouncement(campaign.message, recipient);
    const inserted = await Notification.updateOne({ dedupeKey: `creator-announcement:${campaign._id}:${recipient.user}` }, { $setOnInsert: { user: recipient.user, type: "creator_announcement", title, message, priority: 50, actor: campaign.createdBy, dedupeKey: `creator-announcement:${campaign._id}:${recipient.user}`, metadata: { campaignId: String(campaign._id), actionLabel: campaign.actionLabel, actionUrl: campaign.actionUrl } } }, { upsert: true });
    if (inserted.upsertedCount) {
      const room = io?.to(`user:${recipient.user}`);
      room?.emit("creator-announcement:new", { campaignId: String(campaign._id), title, message, actionLabel: campaign.actionLabel, actionUrl: campaign.actionUrl, createdAt: now });
      room?.emit("activity:updated", { type: "creator_announcement", campaignId: String(campaign._id) });
    }
    update.inAppDeliveredAt = now; inc.inAppDelivered = 1;
  }
  if (campaign.channels.includes("EMAIL") && !recipient.emailDeliveredAt && !recipient.emailSkippedReason) {
    if (!recipient.email) { update.emailSkippedReason = "EMAIL_MISSING"; inc.emailSkipped = 1; }
    else try { const result = await sendEmail({ to: recipient.email, ...announcementEmail(campaign, recipient), idempotencyKey: `creator-announcement-${campaign._id}-${recipient.user}` }); if (result.delivered) { update.emailDeliveredAt = now; update.emailProviderId = result.id || ""; inc.emailDelivered = 1; } else { update.emailSkippedReason = result.reason || "EMAIL_SKIPPED"; inc.emailSkipped = 1; } } catch (error) { update.emailError = String(error.message || error).slice(0, 500); inc.emailFailed = 1; }
  }
  await Promise.all([CreatorAnnouncementRecipient.updateOne({ _id: recipient._id }, { $set: update }), CreatorAnnouncement.updateOne({ _id: campaign._id }, { $inc: Object.fromEntries(Object.entries(inc).map(([k, v]) => [`counts.${k}`, v])) })]);
}

export async function processDueCreatorAnnouncements(now = new Date(), io = null) {
  await CreatorAnnouncementRecipient.updateMany({ status: "PROCESSING", updatedAt: { $lt: new Date(now.getTime() - 10 * 60 * 1000) } }, { $set: { status: "PENDING" } });
  const campaigns = await CreatorAnnouncement.find({ status: { $in: ["SCHEDULED", "PROCESSING"] }, scheduledAt: { $lte: now } }).sort({ scheduledAt: 1 }).limit(5);
  for (const campaign of campaigns) {
    if (campaign.status === "SCHEDULED") await CreatorAnnouncement.updateOne({ _id: campaign._id, status: "SCHEDULED" }, { $set: { status: "PROCESSING", startedAt: now } });
    const recipients = await CreatorAnnouncementRecipient.find({ campaign: campaign._id, status: "PENDING" }).limit(25);
    for (const recipient of recipients) { const claimed = await CreatorAnnouncementRecipient.findOneAndUpdate({ _id: recipient._id, status: "PENDING" }, { $set: { status: "PROCESSING" } }, { new: true }); if (claimed) await processRecipient(campaign, claimed, io); }
    const remaining = await CreatorAnnouncementRecipient.countDocuments({ campaign: campaign._id, status: { $ne: "COMPLETED" } });
    if (!remaining) await CreatorAnnouncement.updateOne({ _id: campaign._id }, { $set: { status: "COMPLETED", completedAt: new Date(), "counts.pending": 0 } });
  }
}

export async function snapshotRecipients(campaign, filter) {
  const cursor = User.find(filter).select("_id email name username").lean().cursor(); let batch = []; let count = 0;
  for await (const user of cursor) { batch.push({ campaign: campaign._id, user: user._id, email: user.email || "", name: user.name || "", username: user.username || "" }); if (batch.length === 500) { await CreatorAnnouncementRecipient.insertMany(batch, { ordered: false }); count += batch.length; batch = []; } }
  if (batch.length) { await CreatorAnnouncementRecipient.insertMany(batch, { ordered: false }); count += batch.length; }
  await CreatorAnnouncement.updateOne({ _id: campaign._id }, { $set: { "counts.recipients": count, "counts.pending": count } });
  return count;
}
