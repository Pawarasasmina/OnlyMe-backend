import AdminProfile from "../models/AdminProfile.js";
import MessageReport from "../models/MessageReport.js";
import ModerationAlert from "../models/ModerationAlert.js";
import Notification from "../models/Notification.js";
import PublicationReport from "../models/PublicationReport.js";
import User from "../models/User.js";
import { env } from "../config/env.js";
import { sendEmail } from "./emailService.js";
import { alertSettings, sendTelegram } from "./alertSettingsService.js";

const OPEN = ["RECEIVED", "REVIEWING"];
const RETRIES_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
export const reportAdminPath = (report, model = report?.__model) => {
  const id = String(report?._id || "");
  if (model === "MessageReport") {
    if (["MESSAGE", "GROUP_MESSAGE", "CONVERSATION"].includes(report?.scope)) return `/admin/message-reports/${id}`;
    if (["PROFILE", "PROFILE_MEDIA"].includes(report?.scope)) return `/admin/user-reports/${id}`;
    return `/admin/post-reports/${id}`;
  }
  return `/admin/safety?report=${encodeURIComponent(`${model}:${id}`)}`;
};
export const reportTypeLabel = (report, model = report?.__model) => {
  if (model === "PublicationReport") return String(report?.kind || "PUBLICATION").replaceAll("_", " ");
  const labels = { MESSAGE: "MESSAGE", GROUP_MESSAGE: "GROUP MESSAGE", CONVERSATION: "CONVERSATION", PROFILE: "USER PROFILE", PROFILE_MEDIA: "PROFILE MEDIA", FEED_POST: "POST", COMMENT: "COMMENT", SEEN: "SEEN", CHAPTER: "SEEN CHAPTER", WORLD: "WORLD", STORY: "STORY", GIFT: "GIFT", DIRECT_ACCESS: "DIRECT ACCESS" };
  return labels[report?.scope] || String(report?.scope || "REPORT").replaceAll("_", " ");
};
const reportUrl = (report, model = report?.__model) => `${env.clientUrl.replace(/\/$/, "")}${reportAdminPath(report, model)}`;
const titleFor = (report, stage) => `${stage === "NEW" ? "New" : stage === "UNCLAIMED_30M" ? "Unclaimed" : stage === "DUE_SOON" ? "SLA warning" : "OVERDUE"} ${report.priority === "URGENT" ? "urgent " : ""}safety report`;
const timeLeft = (dueAt) => { const ms = new Date(dueAt) - new Date(); if (ms <= 0) return `${Math.max(1, Math.round(Math.abs(ms) / 3600000))}h overdue`; const minutes = Math.max(1, Math.ceil(ms / 60000)); return minutes < 60 ? `${minutes}m left` : `${Math.ceil(minutes / 60)}h left`; };
const textFor = (report, stage) => {
  const heading = stage === "UNCLAIMED_30M" ? "🚨 URGENT REPORT NOT PICKED UP" : stage === "OVERDUE" || stage === "OVERDUE_REPEAT" ? "⛔ OVERDUE REPORT" : stage === "DUE_SOON" ? "⚠️ REPORT SLA WARNING" : report.priority === "URGENT" ? "🔴 URGENT REPORT" : "🟠 STANDARD REPORT";
  return [heading, `Report ID: ${report._id}`, `Report type: ${reportTypeLabel(report)}`, `Category: ${String(report.reason || "OTHER").replaceAll("_", " ")}`, `Priority: ${report.priority === "URGENT" ? "Urgent" : "Standard"}`, `Deadline: ${timeLeft(report.dueAt)}`, reportUrl(report)].join("\n");
};

async function moderators() {
  const users = await User.find({ role: "admin", status: "active", adminRole: { $in: ["MAIN_ADMIN", "MODERATOR", null] } }).select("name email adminRole").lean();
  const profiles = await AdminProfile.find({ user: { $in: users.map((user) => user._id) } }).lean();
  const byUser = new Map(profiles.map((profile) => [String(profile.user), profile]));
  return users.map((user) => ({ ...user, preferences: byUser.get(String(user._id))?.notificationPreferences || {} }));
}

async function ensureAlert(report, reportModel, stage, channel, recipientKey) {
  try {
    await ModerationAlert.updateOne(
      { reportModel, reportId: report._id, stage, channel, recipientKey },
      { $setOnInsert: { reportModel, reportId: report._id, stage, channel, recipientKey, nextAttemptAt: new Date() } },
      { upsert: true },
    );
  } catch (error) { if (error?.code !== 11000) throw error; }
}

async function queueStage(report, reportModel, stage) {
  report.__model = reportModel;
  const recipients = await moderators();
  for (const moderator of recipients) {
    if (moderator.preferences?.inApp !== false && moderator.preferences?.moderation !== false) await ensureAlert(report, reportModel, stage, "IN_APP", String(moderator._id));
  }
  const settings = await alertSettings();
  if (settings.enabled && settings.tokenConfigured && settings.moderatorChatId) await ensureAlert(report, reportModel, stage, "TELEGRAM", settings.moderatorChatId);
  else if (settings.emailFallback) for (const moderator of recipients) if (moderator.email && moderator.preferences?.email !== false) await ensureAlert(report, reportModel, stage, "EMAIL", moderator.email);
}

function stageFor(report, now) {
  const due = new Date(report.dueAt).getTime();
  const created = new Date(report.createdAt).getTime();
  if (!Number.isFinite(due)) return [];
  const age = now.getTime() - created;
  if (report.priority === "URGENT" && !report.reviewingAt && age >= 30 * 60 * 1000 && now.getTime() < due) return ["UNCLAIMED_30M"];
  if (now.getTime() >= due + 4 * 60 * 60 * 1000) return ["OVERDUE_REPEAT"];
  if (now.getTime() >= due) return ["OVERDUE"];
  if (age <= 5 * 60 * 1000) return ["NEW"];
  const window = due - created;
  if (due - now.getTime() <= Math.min(window / 4, 4 * 60 * 60 * 1000)) return ["DUE_SOON"];
  return [];
}

async function queueReportRows(Model, reportModel, now) {
  const rows = await Model.find({ status: { $in: OPEN }, dueAt: { $ne: null } }).select("reason scope kind priority dueAt createdAt reviewingAt").limit(1000).lean();
  for (const report of rows) for (const stage of stageFor(report, now)) await queueStage(report, reportModel, stage);
}

async function deliverTelegram(alert, report, message) {
  return sendTelegram({ chatId: alert.recipientKey, text: message, buttonText: "Open report in admin", buttonUrl: reportUrl(report, alert.reportModel) });
}

async function deliver(alert, io) {
  const Model = alert.reportModel === "MessageReport" ? MessageReport : PublicationReport;
  const report = await Model.findById(alert.reportId).select("reason scope kind priority dueAt createdAt status").lean();
  if (!report || !OPEN.includes(report.status)) return { status: "SKIPPED", providerId: "REPORT_CLOSED" };
  const overdueBy = Date.now() - new Date(report.dueAt).getTime();
  if (alert.stage === "OVERDUE" && overdueBy >= 4 * 60 * 60 * 1000) return { status: "SKIPPED", providerId: "SUPERSEDED_OVERDUE_ALERT" };
  report.__model = alert.reportModel; const title = titleFor(report, alert.stage); const message = textFor(report, alert.stage);
  if (alert.channel === "IN_APP") {
    const key = `moderation-alert:${alert.reportModel}:${alert.reportId}:${alert.stage}:${alert.recipientKey}`;
    await Notification.updateOne({ dedupeKey: key }, { $setOnInsert: { user: alert.recipientKey, type: "moderation_alert", title, message, severity: alert.stage.includes("OVERDUE") || report.priority === "URGENT" ? "critical" : "warning", priority: report.priority === "URGENT" ? 100 : 85, metadata: { reportModel: alert.reportModel, reportId: String(alert.reportId), url: reportAdminPath(report, alert.reportModel) }, dedupeKey: key } }, { upsert: true });
    io?.to(`user:${alert.recipientKey}`).emit("moderation:alert", { title, message, reportModel: alert.reportModel, reportId: String(alert.reportId), stage: alert.stage });
    return { status: "DELIVERED", providerId: key };
  }
  if (alert.channel === "EMAIL") {
    const result = await sendEmail({ to: alert.recipientKey, subject: `[Safety] ${title}`, text: `${message}\n\nReview: ${reportUrl(report, alert.reportModel)}`, idempotencyKey: `moderation-${alert._id}` });
    return { status: result.delivered ? "DELIVERED" : "SKIPPED", providerId: result.id || result.reason || "" };
  }
  return { status: "DELIVERED", providerId: await deliverTelegram(alert, report, message) };
}

async function deliverQueuedAlerts(now, io, filter = {}) {
  let processed = 0;
  for (; processed < 100; processed += 1) {
    const alert = await ModerationAlert.findOneAndUpdate({ ...filter, status: { $in: ["PENDING", "FAILED"] }, nextAttemptAt: { $lte: now }, attempts: { $lt: RETRIES_MS.length + 1 } }, { $set: { status: "SENDING" }, $inc: { attempts: 1 } }, { new: true, sort: { createdAt: 1 } });
    if (!alert) break;
    try {
      const result = await deliver(alert, io); alert.status = result.status; alert.providerId = result.providerId; alert.deliveredAt = result.status === "DELIVERED" ? new Date() : null; alert.error = "";
    } catch (error) {
      alert.status = "FAILED"; alert.error = String(error?.message || error).slice(0, 1000); alert.nextAttemptAt = new Date(Date.now() + RETRIES_MS[Math.min(alert.attempts - 1, RETRIES_MS.length - 1)]);
      if (alert.channel === "TELEGRAM") { const settings = await alertSettings(); if (settings.emailFallback) for (const moderator of await moderators()) if (moderator.email && moderator.preferences?.email !== false) await ensureAlert({ _id: alert.reportId }, alert.reportModel, alert.stage, "EMAIL", moderator.email); }
    }
    await alert.save();
  }
  return { processed };
}

export async function processNewModerationAlert(report, reportModel, io = null) {
  await queueStage(report, reportModel, "NEW");
  return deliverQueuedAlerts(new Date(), io, { reportModel, reportId: report._id, stage: "NEW" });
}

export async function processModerationAlerts(now = new Date(), io = null) {
  await ModerationAlert.updateMany({ status: "SENDING", updatedAt: { $lt: new Date(now.getTime() - 5 * 60000) } }, { $set: { status: "FAILED", nextAttemptAt: now, error: "Delivery worker interrupted; retrying" } });
  await Promise.all([queueReportRows(MessageReport, "MessageReport", now), queueReportRows(PublicationReport, "PublicationReport", now)]);
  return deliverQueuedAlerts(now, io);
}
