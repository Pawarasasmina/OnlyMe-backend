import mongoose from "mongoose";
import User from "../models/User.js";
import MessageReport from "../models/MessageReport.js";
import PublicationReport from "../models/PublicationReport.js";
import Publication from "../models/Publication.js";
import FeedPost from "../models/FeedPost.js";
import Message from "../models/Message.js";
import GroupMessage from "../models/GroupMessage.js";
import Story from "../models/Story.js";
import Notification from "../models/Notification.js";
import ModerationAppeal from "../models/ModerationAppeal.js";
import AdminAuditEvent from "../models/AdminAuditEvent.js";
import AdminLoginEvent from "../models/AdminLoginEvent.js";
import LegalHold from "../models/LegalHold.js";
import PayoutHold from "../models/PayoutHold.js";
import PlatformSetting from "../models/PlatformSetting.js";
import Wallet from "../models/Wallet.js";
import StarsLedgerEntry from "../models/StarsLedgerEntry.js";
import WorldEntitlement from "../models/WorldEntitlement.js";
import PremiumMembership from "../models/PremiumMembership.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { effectiveAdminRole } from "../middleware/adminPermissionMiddleware.js";

const URGENT = new Set(["CHILD_SAFETY", "SELF_HARM", "DEFAMATION"]);
const clean = (value, max = 2000) => String(value || "").trim().slice(0, max);
const validId = (id, label = "ID") => { if (!mongoose.isValidObjectId(id)) throw new ApiError(400, `Invalid ${label}`); return id; };
const defaultPolicy = {
  urgentHours: 4, standardHours: 24, contextMessages: 3,
  autoHideCategories: ["CHILD_SAFETY", "SELF_HARM", "DEFAMATION"],
  reporterOutcomeText: "We reviewed your report and took the appropriate action. Thank you for helping keep OnlyMe safe.",
  authorActionText: "We took action because this content or activity violated our community rules. You may submit one appeal.",
  appealInstructions: "Open the moderation notice and submit one appeal with any relevant context.",
};

async function policy() {
  const row = await PlatformSetting.findOne({ key: "moderation-policy" }).lean();
  return { ...defaultPolicy, ...(row?.value || {}) };
}
async function audit(req, action, targetType, targetId, reason, before = null, after = null, metadata = {}) {
  return AdminAuditEvent.create({ actor: req.user._id, actorRole: effectiveAdminRole(req.user), action, targetType, targetId: String(targetId), reason, before, after, metadata });
}
function normalizedReport(row, model) {
  const reason = row.reason || "OTHER";
  const urgent = row.priority === "URGENT" || URGENT.has(reason);
  const created = new Date(row.createdAt);
  const dueAt = row.dueAt || new Date(created.getTime() + (urgent ? 4 : 24) * 3600000);
  const author = model === "MessageReport" ? row.reportedUser : row.creator;
  return { ...row, id: row._id, model, author, priority: urgent ? "URGENT" : "STANDARD", priorityRank: urgent ? 2 : 1, dueAt, overdue: !["RESOLVED", "CLOSED"].includes(row.status) && new Date(dueAt) < new Date() };
}
function reportTargetKey(row, model) {
  if (model === "PublicationReport") return `publication:${row.publication}`;
  for (const field of ["message", "groupMessage", "commentId", "feedPost", "profileMedia", "story", "chapterId", "directAccessWindow", "publication"]) if (row[field]) return `${row.scope}:${row[field]}`;
  return `${row.scope}:user:${row.reportedUser?._id || row.reportedUser}`;
}
function siblingFilter(report, model) {
  if (model === "PublicationReport") return { publication: report.publication, status: { $in: ["RECEIVED", "REVIEWING"] } };
  for (const field of ["message", "groupMessage", "commentId", "feedPost", "profileMedia", "story", "chapterId", "directAccessWindow", "publication"]) if (report[field]) return { scope: report.scope, [field]: report[field], status: { $in: ["RECEIVED", "REVIEWING"] } };
  return { scope: report.scope, reportedUser: report.reportedUser?._id || report.reportedUser, status: { $in: ["RECEIVED", "REVIEWING"] } };
}

export const listUnifiedReports = asyncHandler(async (req, res) => {
  const status = clean(req.query.status, 30).toUpperCase();
  const match = status && ["RECEIVED", "REVIEWING", "RESOLVED", "CLOSED"].includes(status) ? { status } : {};
  const [messages, publications] = await Promise.all([
    MessageReport.find(match).select("+snapshot").populate("reporter", "name username email avatar").populate("reportedUser", "name username email avatar status").populate("reviewedBy", "name username").sort({ createdAt: -1 }).limit(500).lean(),
    PublicationReport.find(match).populate("reporter", "name username email avatar").populate("creator", "name username email avatar status").populate("reviewedBy", "name username").sort({ createdAt: -1 }).limit(500).lean(),
  ]);
  const rawItems = [...messages.map((row) => normalizedReport(row, "MessageReport")), ...publications.map((row) => normalizedReport(row, "PublicationReport"))];
  const reportCounts = rawItems.reduce((map, item) => map.set(reportTargetKey(item, item.model), (map.get(reportTargetKey(item, item.model)) || 0) + 1), new Map());
  const items = rawItems.map((item) => ({ ...item, reportCount: reportCounts.get(reportTargetKey(item, item.model)) || 1 }))
    .filter((item) => !req.query.priority || item.priority === String(req.query.priority).toUpperCase())
    .sort((a, b) => b.priorityRank - a.priorityRank || new Date(a.createdAt) - new Date(b.createdAt));
  const page = Math.max(1, Number(req.query.page) || 1); const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
  const open = items.filter((item) => !["RESOLVED", "CLOSED"].includes(item.status));
  return sendResponse(res, 200, "Unified report queue fetched", { items: items.slice((page - 1) * limit, page * limit), summary: { total: items.length, open: open.length, urgent: open.filter((item) => item.priority === "URGENT").length, overdue: open.filter((item) => item.overdue).length }, pagination: { page, limit, total: items.length, pages: Math.max(1, Math.ceil(items.length / limit)) } });
});

async function findReport(model, id) {
  validId(id, "report ID");
  if (model === "MessageReport") return MessageReport.findById(id).select("+snapshot").populate("reporter", "name username email avatar").populate("reportedUser", "name username email avatar status postingRestrictedUntil sellingRestrictedUntil").populate("reviewedBy", "name username");
  if (model === "PublicationReport") return PublicationReport.findById(id).populate("reporter", "name username email avatar").populate("creator", "name username email avatar status postingRestrictedUntil sellingRestrictedUntil").populate("reviewedBy", "name username");
  throw new ApiError(400, "Invalid report model");
}

export const getUnifiedReport = asyncHandler(async (req, res) => {
  const report = await findReport(req.params.model, req.params.id);
  if (!report) throw new ApiError(404, "Report not found");
  const authorId = report.reportedUser?._id || report.creator?._id;
  const ReportModel = req.params.model === "MessageReport" ? MessageReport : PublicationReport;
  const [history, appeals, reportCount] = await Promise.all([
    AdminAuditEvent.find({ targetType: { $in: ["USER", "REPORT"] }, $or: [{ targetId: String(authorId) }, { targetId: String(report._id) }] }).populate("actor", "name username").sort({ createdAt: -1 }).limit(100).lean(),
    ModerationAppeal.find({ reportModel: req.params.model, reportId: report._id }).populate("reviewer appellant", "name username").lean(),
    ReportModel.countDocuments({ ...siblingFilter(report, req.params.model), status: { $in: ["RECEIVED", "REVIEWING", "RESOLVED", "CLOSED"] } }),
  ]);
  return sendResponse(res, 200, "Moderation case fetched", { report: { ...normalizedReport(report.toObject(), req.params.model), reportCount }, history, appeals });
});

async function applyContentAction(report, model, action) {
  if (model === "PublicationReport" && ["HIDDEN", "REMOVED"].includes(action)) await Publication.updateOne({ _id: report.publication }, { $set: { status: action === "REMOVED" ? "REMOVED" : "ARCHIVED" } });
  if (model === "MessageReport" && report.feedPost && ["HIDDEN", "REMOVED"].includes(action)) await FeedPost.updateOne({ _id: report.feedPost }, { $set: { status: action === "REMOVED" ? "deleted" : "archived", ...(action === "REMOVED" ? { deletedAt: new Date() } : { archivedAt: new Date() }) } });
  if (model === "MessageReport" && report.message && ["HIDDEN", "REMOVED"].includes(action)) await Message.updateOne({ _id: report.message }, { $set: { deletedAt: new Date() } });
  if (model === "MessageReport" && report.groupMessage && ["HIDDEN", "REMOVED"].includes(action)) await GroupMessage.updateOne({ _id: report.groupMessage }, { $set: { deletedAt: new Date() } });
  if (model === "MessageReport" && report.story && ["HIDDEN", "REMOVED"].includes(action)) await Story.updateOne({ _id: report.story }, { $set: { audience: "only_me", ...(action === "REMOVED" ? { expiresAt: new Date() } : {}) } });
  if (model === "MessageReport" && report.scope === "PROFILE" && ["HIDDEN", "REMOVED"].includes(action)) await User.updateOne({ _id: report.reportedUser?._id || report.reportedUser }, { $set: { profileModerationHiddenAt: new Date() } });
}

export const actionUnifiedReport = asyncHandler(async (req, res) => {
  const action = clean(req.body.action, 80).toUpperCase(); const reason = clean(req.body.reason);
  const allowed = new Set(["NO_ACTION", "HIDDEN", "REMOVED", "WARNING", "POSTING_RESTRICTED", "SELLING_RESTRICTED", "MESSAGING_RESTRICTED", "ACCOUNT_RESTRICTED", "SUSPENDED", "BANNED"]);
  if (!allowed.has(action) || reason.length < 3) throw new ApiError(400, "Choose an action and enter a reason");
  const report = await findReport(req.params.model, req.params.id); if (!report) throw new ApiError(404, "Report not found");
  if (["RESOLVED", "CLOSED"].includes(report.status)) throw new ApiError(409, "This report is already resolved");
  const authorId = report.reportedUser?._id || report.creator?._id; const durationDays = Math.min(365, Math.max(1, Number(req.body.durationDays) || 7)); const until = new Date(Date.now() + durationDays * 86400000);
  const userUpdate = {};
  if (action === "POSTING_RESTRICTED") Object.assign(userUpdate, { postingRestrictedUntil: until, postingRestrictionReason: reason });
  if (action === "SELLING_RESTRICTED") Object.assign(userUpdate, { sellingRestrictedUntil: until, sellingRestrictionReason: reason });
  if (action === "MESSAGING_RESTRICTED") Object.assign(userUpdate, { messagingRestrictedUntil: until, messagingRestrictionReason: reason, messagingRestrictedBy: req.user._id });
  if (action === "ACCOUNT_RESTRICTED") Object.assign(userUpdate, { loginRestrictedUntil: until, loginRestrictionReason: reason, loginRestrictedBy: req.user._id });
  if (action === "SUSPENDED") Object.assign(userUpdate, { status: "suspended", authVersion: Number((await User.findById(authorId).select("authVersion").lean())?.authVersion || 0) + 1 });
  if (action === "BANNED") Object.assign(userUpdate, { status: "banned", authVersion: Number((await User.findById(authorId).select("authVersion").lean())?.authVersion || 0) + 1 });
  if (Object.keys(userUpdate).length) await User.updateOne({ _id: authorId }, { $set: userUpdate });
  await applyContentAction(report, req.params.model, action);
  report.status = "RESOLVED"; report.reviewedBy = req.user._id; report.resolvedAt = new Date(); report.resolution = { action, note: reason, restrictionUntil: ["POSTING_RESTRICTED", "SELLING_RESTRICTED", "MESSAGING_RESTRICTED", "ACCOUNT_RESTRICTED"].includes(action) ? until : null }; await report.save();
  const ReportModel = req.params.model === "MessageReport" ? MessageReport : PublicationReport;
  const siblingReports = await ReportModel.find({ ...siblingFilter(report, req.params.model), _id: { $ne: report._id } });
  for (const sibling of siblingReports) { sibling.status = "RESOLVED"; sibling.reviewedBy = req.user._id; sibling.resolvedAt = report.resolvedAt; sibling.resolution = report.resolution; await sibling.save(); }
  const p = await policy();
  const reporters = [report, ...siblingReports].map((item) => item.reporter?._id || item.reporter).filter(Boolean);
  await Notification.insertMany([
    ...reporters.map((reporter, index) => ({ user: reporter, type: "report_outcome", title: "Your report was reviewed", message: p.reporterOutcomeText, relatedReport: req.params.model === "MessageReport" ? report._id : null, dedupeKey: `report-outcome:${req.params.model}:${report._id}:${index}` })),
    { user: authorId, type: "moderation_action", title: `Moderation action: ${action.replaceAll("_", " ").toLowerCase()}`, message: `${reason}\n\n${p.authorActionText}\n${p.appealInstructions}`, relatedReport: req.params.model === "MessageReport" ? report._id : null, severity: ["BANNED", "SUSPENDED", "REMOVED"].includes(action) ? "critical" : "warning", metadata: { reportModel: req.params.model, reportId: String(report._id), appealUrl: `/appeals/${req.params.model}/${report._id}` }, dedupeKey: `author-action:${req.params.model}:${report._id}` },
  ]);
  await audit(req, `MODERATION_${action}`, "REPORT", report._id, reason, { status: "REVIEWING" }, { status: "RESOLVED", action, restrictionUntil: until }, { reportModel: req.params.model, authorId: String(authorId) });
  if (["BANNED", "SUSPENDED"].includes(action)) req.app.get("io")?.in(`user:${authorId}`).disconnectSockets(true);
  return sendResponse(res, 200, "Moderation action completed", { report: normalizedReport(report.toObject(), req.params.model) });
});

export const listAppeals = asyncHandler(async (req, res) => {
  const filter = req.query.status ? { status: clean(req.query.status, 30).toUpperCase() } : {};
  const items = await ModerationAppeal.find(filter).populate("appellant reviewer actionedBy", "name username email").sort({ createdAt: 1 }).lean();
  return sendResponse(res, 200, "Appeals fetched", { items });
});
export const submitAppeal = asyncHandler(async (req, res) => {
  const model = clean(req.body.reportModel, 40); const report = await findReport(model, req.body.reportId);
  if (!report) throw new ApiError(404, "Moderation action not found");
  const authorId = report.reportedUser?._id || report.reportedUser || report.creator?._id || report.creator;
  if (String(authorId) !== String(req.user._id)) throw new ApiError(403, "You can only appeal an action on your account or content");
  if (!["RESOLVED", "CLOSED"].includes(report.status) || !report.resolution?.action || report.resolution.action === "NO_ACTION") throw new ApiError(409, "This action cannot be appealed");
  const statement = clean(req.body.statement, 3000); if (statement.length < 10) throw new ApiError(400, "Tell us why this decision should be reviewed");
  try { const appeal = await ModerationAppeal.create({ appellant: req.user._id, reportModel: model, reportId: report._id, actionedBy: report.reviewedBy?._id || report.reviewedBy, action: report.resolution.action, statement }); return sendResponse(res, 201, "Appeal submitted", { appeal }); }
  catch (error) { if (error?.code === 11000) throw new ApiError(409, "Only one appeal is allowed for this action"); throw error; }
});
export const reviewAppeal = asyncHandler(async (req, res) => {
  const appeal = await ModerationAppeal.findById(validId(req.params.id, "appeal ID")); if (!appeal) throw new ApiError(404, "Appeal not found");
  if (String(appeal.actionedBy) === String(req.user._id)) throw new ApiError(409, "A different staff member must review this appeal");
  const decision = clean(req.body.decision, 40).toUpperCase(); const reason = clean(req.body.reason);
  if (!["UPHELD", "REVERSED", "PARTIALLY_REVERSED"].includes(decision) || reason.length < 3) throw new ApiError(400, "Choose a decision and enter a reason");
  if (["REVERSED", "PARTIALLY_REVERSED"].includes(decision)) {
    const report = await findReport(appeal.reportModel, appeal.reportId);
    if (report) {
      const authorId = report.reportedUser?._id || report.reportedUser || report.creator?._id || report.creator;
      const clear = {};
      if (["BANNED", "SUSPENDED"].includes(appeal.action)) Object.assign(clear, { status: "active" });
      if (appeal.action === "POSTING_RESTRICTED") Object.assign(clear, { postingRestrictedUntil: null, postingRestrictionReason: "" });
      if (appeal.action === "SELLING_RESTRICTED") Object.assign(clear, { sellingRestrictedUntil: null, sellingRestrictionReason: "" });
      if (appeal.action === "MESSAGING_RESTRICTED") Object.assign(clear, { messagingRestrictedUntil: null, messagingRestrictionReason: "", messagingRestrictedBy: null });
      if (appeal.action === "ACCOUNT_RESTRICTED") Object.assign(clear, { loginRestrictedUntil: null, loginRestrictionReason: "", loginRestrictedBy: null });
      if (Object.keys(clear).length) await User.updateOne({ _id: authorId }, { $set: clear, $inc: { authVersion: ["BANNED", "SUSPENDED"].includes(appeal.action) ? 1 : 0 } });
      if (appeal.reportModel === "PublicationReport" && ["HIDDEN", "REMOVED"].includes(appeal.action)) await Publication.updateOne({ _id: report.publication }, { $set: { status: "PUBLISHED", archivedAt: null } });
      if (appeal.reportModel === "MessageReport" && report.feedPost && ["HIDDEN", "REMOVED"].includes(appeal.action)) await FeedPost.updateOne({ _id: report.feedPost }, { $set: { status: "published", archivedAt: null, deletedAt: null } });
      if (appeal.reportModel === "MessageReport" && report.message && ["HIDDEN", "REMOVED"].includes(appeal.action)) await Message.updateOne({ _id: report.message }, { $set: { deletedAt: null } });
      if (appeal.reportModel === "MessageReport" && report.groupMessage && ["HIDDEN", "REMOVED"].includes(appeal.action)) await GroupMessage.updateOne({ _id: report.groupMessage }, { $set: { deletedAt: null } });
      if (appeal.reportModel === "MessageReport" && report.scope === "PROFILE" && ["HIDDEN", "REMOVED"].includes(appeal.action)) await User.updateOne({ _id: authorId }, { $set: { profileModerationHiddenAt: null } });
    }
  }
  appeal.status = decision; appeal.reviewer = req.user._id; appeal.reviewReason = reason; appeal.reviewedAt = new Date(); await appeal.save();
  await Notification.create({ user: appeal.appellant, type: "appeal_outcome", title: `Appeal ${decision.toLowerCase().replaceAll("_", " ")}`, message: reason, dedupeKey: `appeal-outcome:${appeal._id}` });
  await audit(req, `APPEAL_${decision}`, "APPEAL", appeal._id, reason, { status: "PENDING" }, { status: decision });
  return sendResponse(res, 200, "Appeal reviewed", { appeal });
});

export const getModerationPolicy = asyncHandler(async (_req, res) => sendResponse(res, 200, "Moderation policy fetched", { policy: await policy() }));
export const updateModerationPolicy = asyncHandler(async (req, res) => {
  const current = await policy(); const next = { ...current, urgentHours: Math.min(24, Math.max(1, Number(req.body.urgentHours) || current.urgentHours)), standardHours: Math.min(168, Math.max(1, Number(req.body.standardHours) || current.standardHours)), contextMessages: Math.min(5, Math.max(1, Number(req.body.contextMessages) || current.contextMessages)), autoHideCategories: Array.isArray(req.body.autoHideCategories) ? req.body.autoHideCategories.map((x) => clean(x, 40).toUpperCase()).filter((x) => URGENT.has(x)) : current.autoHideCategories, reporterOutcomeText: clean(req.body.reporterOutcomeText || current.reporterOutcomeText), authorActionText: clean(req.body.authorActionText || current.authorActionText), appealInstructions: clean(req.body.appealInstructions || current.appealInstructions) };
  await PlatformSetting.findOneAndUpdate({ key: "moderation-policy" }, { $set: { value: next, updatedBy: req.user._id } }, { upsert: true, new: true }); await audit(req, "MODERATION_POLICY_UPDATED", "SETTING", "moderation-policy", clean(req.body.reason) || "Policy settings updated", current, next); return sendResponse(res, 200, "Moderation policy updated", { policy: next });
});

export const getAdminUserDetail = asyncHandler(async (req, res) => {
  const user = await User.findById(validId(req.params.id, "user ID")).select("+accountType name username email role profileType accountType status isVerified creatorApprovalStatus createdAt authVersion postingRestrictedUntil postingRestrictionReason sellingRestrictedUntil sellingRestrictionReason messagingRestrictedUntil loginRestrictedUntil").lean(); if (!user || user.role === "admin") throw new ApiError(404, "User not found");
  const [reports, actions, logins, holds] = await Promise.all([MessageReport.find({ reportedUser: user._id }).select("-snapshot").sort({ createdAt: -1 }).limit(100).lean(), AdminAuditEvent.find({ $or: [{ targetType: "USER", targetId: String(user._id) }, { "metadata.authorId": String(user._id) }] }).populate("actor", "name username").sort({ createdAt: -1 }).lean(), AdminLoginEvent.find({ user: user._id }).sort({ createdAt: -1 }).limit(50).lean(), LegalHold.find({ targetType: "USER", targetId: String(user._id), active: true }).lean()]);
  return sendResponse(res, 200, "Admin user detail fetched", { user, reports, actions, logins, holds });
});
export const enforceUser = asyncHandler(async (req, res) => {
  const user = await User.findById(validId(req.params.id, "user ID")); if (!user || user.role === "admin") throw new ApiError(404, "User not found"); const action = clean(req.body.action, 50).toUpperCase(); const reason = clean(req.body.reason); if (reason.length < 3) throw new ApiError(400, "A reason is required"); const days = Math.min(365, Math.max(1, Number(req.body.durationDays) || 7)); const until = new Date(Date.now() + days * 86400000); const before = { status: user.status };
  if (action === "WARN") await Notification.create({ user: user._id, type: "moderation_warning", title: "Account warning", message: reason, severity: "warning", dedupeKey: `user-warning:${user._id}:${Date.now()}` });
  else if (action === "RESTRICT_POSTING") { user.postingRestrictedUntil = until; user.postingRestrictionReason = reason; }
  else if (action === "RESTRICT_SELLING") { user.sellingRestrictedUntil = until; user.sellingRestrictionReason = reason; }
  else if (action === "SUSPEND") { user.status = "suspended"; user.authVersion += 1; }
  else if (action === "BAN") { user.status = "banned"; user.authVersion += 1; }
  else if (action === "UNBAN") { user.status = "active"; user.authVersion += 1; }
  else if (action === "FORCE_LOGOUT") user.authVersion += 1;
  else if (action === "RESET_VERIFICATION") { user.isVerified = false; user.creatorApprovalStatus = null; }
  else throw new ApiError(400, "Invalid user action");
  await user.save(); await audit(req, `USER_${action}`, "USER", user._id, reason, before, { status: user.status, until: ["RESTRICT_POSTING", "RESTRICT_SELLING"].includes(action) ? until : null });
  if (action === "FORCE_LOGOUT") await AdminLoginEvent.create({ user: user._id, outcome: "FORCE_LOGOUT", ip: String(req.ip || "").slice(0, 100), userAgent: String(req.get("User-Agent") || "").slice(0, 500), deviceType: "unknown" });
  if (["SUSPEND", "BAN", "UNBAN", "FORCE_LOGOUT"].includes(action)) req.app.get("io")?.in(`user:${user._id}`).disconnectSockets(true);
  return sendResponse(res, 200, "User action completed", { user: { id: user._id, status: user.status, postingRestrictedUntil: user.postingRestrictedUntil, sellingRestrictedUntil: user.sellingRestrictedUntil } });
});

export const listAuditEvents = asyncHandler(async (req, res) => { const page = Math.max(1, Number(req.query.page) || 1); const limit = 50; const filter = req.query.action ? { action: new RegExp(clean(req.query.action, 80), "i") } : {}; const [items, total] = await Promise.all([AdminAuditEvent.find(filter).populate("actor", "name username email").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), AdminAuditEvent.countDocuments(filter)]); return sendResponse(res, 200, "Audit events fetched", { items, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } }); });
export const listLegalHolds = asyncHandler(async (req, res) => { const active = req.query.active === "false" ? false : true; const items = await LegalHold.find({ active }).populate("placedBy releasedBy", "name username email").sort({ createdAt: -1 }).limit(200).lean(); return sendResponse(res, 200, "Deletion holds fetched", { items }); });

export const searchGovernanceTargets = asyncHandler(async (req, res) => {
  const type = clean(req.query.type, 20).toUpperCase();
  const search = clean(req.query.search, 120).replace(/^@/, "");
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escaped, "i");
  let items = [];
  if (type === "USER") {
    const filter = search ? { $or: [{ name: regex }, { username: regex }, { email: regex }, { phone: regex }, ...(mongoose.isValidObjectId(search) ? [{ _id: search }] : [])] } : {};
    const rows = await User.find(filter).select("name username email phone status role").sort({ createdAt: -1 }).limit(20).lean();
    items = rows.map((row) => ({ id: row._id, title: row.name || row.username, subtitle: `@${row.username || "unknown"} · ${row.email || row.phone || row.role}`, badge: row.status }));
  } else if (type === "REPORT") {
    const filter = search ? { $or: [{ reason: regex }, { details: regex }, ...(mongoose.isValidObjectId(search) ? [{ _id: search }] : [])] } : {};
    const [messageRows, publicationRows] = await Promise.all([
      MessageReport.find(filter).populate("reportedUser", "name username").sort({ createdAt: -1 }).limit(15).lean(),
      PublicationReport.find(filter).populate("creator", "name username").sort({ createdAt: -1 }).limit(15).lean(),
    ]);
    items = [...messageRows.map((row) => ({ id: row._id, title: `${row.reason} · ${row.scope}`, subtitle: `Reported user: @${row.reportedUser?.username || "unknown"} · ${new Date(row.createdAt).toLocaleDateString()}`, badge: row.status })), ...publicationRows.map((row) => ({ id: row._id, title: `${row.reason} · Publication`, subtitle: `Creator: @${row.creator?.username || "unknown"} · ${new Date(row.createdAt).toLocaleDateString()}`, badge: row.status }))].slice(0, 20);
  } else if (type === "CONTENT") {
    const contentType = clean(req.query.contentType, 20).toUpperCase() || "ALL";
    const publicationFilter = search ? { $or: [{ title: regex }, { summary: regex }, ...(mongoose.isValidObjectId(search) ? [{ _id: search }] : [])] } : {};
    const postFilter = search ? { $or: [{ text: regex }, { caption: regex }, ...(mongoose.isValidObjectId(search) ? [{ _id: search }] : [])] } : {};
    const storyFilter = search ? { $or: [{ caption: regex }, ...(mongoose.isValidObjectId(search) ? [{ _id: search }] : [])] } : {};
    const [publications, posts, stories] = await Promise.all([
      Publication.find(publicationFilter).populate("creator", "username").sort({ createdAt: -1 }).limit(10).lean(),
      FeedPost.find(postFilter).populate("author", "username").sort({ createdAt: -1 }).limit(10).lean(),
      Story.find(storyFilter).populate("creator", "username").sort({ createdAt: -1 }).limit(10).lean(),
    ]);
    items = [...(["ALL", "PUBLICATION"].includes(contentType) ? publications.map((row) => ({ id: row._id, title: row.title || "Untitled publication", subtitle: `${row.kind || "Publication"} · @${row.creator?.username || "unknown"}`, badge: row.status })) : []), ...(["ALL", "POST"].includes(contentType) ? posts.map((row) => ({ id: row._id, title: row.text || row.caption || "Media post", subtitle: `Post · @${row.author?.username || "unknown"}`, badge: row.status })) : []), ...(["ALL", "STORY"].includes(contentType) ? stories.map((row) => ({ id: row._id, title: row.caption || "Story", subtitle: `Story · @${row.creator?.username || "unknown"}`, badge: "STORY" })) : [])].slice(0, 20);
  } else throw new ApiError(400, "Target type must be USER, REPORT, or CONTENT");
  return sendResponse(res, 200, "Governance targets fetched", { items });
});

export const createLegalHold = asyncHandler(async (req, res) => { const targetType = clean(req.body.targetType, 30).toUpperCase(); const targetId = clean(req.body.targetId, 120); const reason = clean(req.body.reason); if (!["USER", "CONTENT", "REPORT"].includes(targetType) || !targetId || reason.length < 3) throw new ApiError(400, "Target and reason are required"); const hold = await LegalHold.create({ targetType, targetId, reason, placedBy: req.user._id }); await audit(req, "LEGAL_HOLD_PLACED", "LEGAL_HOLD", hold._id, reason, null, { targetType, targetId }); return sendResponse(res, 201, "Legal hold placed", { hold }); });
export const releaseLegalHold = asyncHandler(async (req, res) => { const reason = clean(req.body.reason); if (reason.length < 3) throw new ApiError(400, "A release reason is required"); const hold = await LegalHold.findOneAndUpdate({ _id: validId(req.params.id, "hold ID"), active: true }, { $set: { active: false, releasedBy: req.user._id, releasedAt: new Date(), releaseReason: reason } }, { new: true }); if (!hold) throw new ApiError(404, "Active hold not found"); await audit(req, "LEGAL_HOLD_RELEASED", "LEGAL_HOLD", hold._id, reason, { active: true }, { active: false }); return sendResponse(res, 200, "Legal hold released", { hold }); });

export const exportHistory = asyncHandler(async (req, res) => { const type = clean(req.query.type, 20).toUpperCase(); const id = validId(req.query.id, "export target ID"); let payload; if (type === "USER") { const user = await User.findById(id).select("-password -resetPasswordToken -resetPasswordExpires").lean(); if (!user) throw new ApiError(404, "User not found"); const [reports, actions, ledger] = await Promise.all([MessageReport.find({ $or: [{ reporter: id }, { reportedUser: id }] }).select("+snapshot").lean(), AdminAuditEvent.find({ targetType: "USER", targetId: String(id) }).lean(), StarsLedgerEntry.find({ accountUser: id }).sort({ createdAt: 1 }).lean()]); payload = { exportedAt: new Date(), type, user, reports, actions, ledger }; } else if (type === "REPORT") { const report = await MessageReport.findById(id).select("+snapshot").lean() || await PublicationReport.findById(id).lean(); if (!report) throw new ApiError(404, "Report not found"); payload = { exportedAt: new Date(), type, report, actions: await AdminAuditEvent.find({ targetType: "REPORT", targetId: String(id) }).lean() }; } else throw new ApiError(400, "Export type must be USER or REPORT"); await audit(req, "DATA_EXPORTED", type, id, clean(req.query.reason) || "Administrative history export"); return sendResponse(res, 200, "History export generated", { export: payload }); });

export const getFinancialUser = asyncHandler(async (req, res) => { const id = validId(req.params.id, "user ID"); const [user, wallet, ledger, payoutHold, worldPurchases, memberships] = await Promise.all([User.findById(id).select("name username email role status").lean(), Wallet.findOne({ user: id }).lean(), StarsLedgerEntry.find({ accountUser: id }).sort({ createdAt: -1 }).limit(500).lean(), PayoutHold.findOne({ user: id, active: true }).lean(), WorldEntitlement.find({ user: id }).populate("publication", "title kind").sort({ createdAt: -1 }).lean(), PremiumMembership.find({ user: id }).populate("premiumPublication", "title kind").sort({ createdAt: -1 }).lean()]); if (!user) throw new ApiError(404, "User not found"); return sendResponse(res, 200, "Financial user fetched", { user, wallet, ledger, payoutHold, purchases: { worlds: worldPurchases, memberships } }); });
export const holdPayouts = asyncHandler(async (req, res) => { const user = validId(req.params.id, "user ID"); const reason = clean(req.body.reason); if (reason.length < 3) throw new ApiError(400, "A reason is required"); const hold = await PayoutHold.create({ user, reason, placedBy: req.user._id }); await audit(req, "PAYOUT_HOLD_PLACED", "USER", user, reason, null, { payoutHoldId: hold._id }); return sendResponse(res, 201, "Payouts placed on hold", { hold }); });
export const releasePayouts = asyncHandler(async (req, res) => { const reason = clean(req.body.reason); if (reason.length < 3) throw new ApiError(400, "A reason is required"); const hold = await PayoutHold.findOneAndUpdate({ user: validId(req.params.id, "user ID"), active: true }, { $set: { active: false, releasedBy: req.user._id, releasedAt: new Date(), releaseReason: reason } }, { new: true }); if (!hold) throw new ApiError(404, "Active payout hold not found"); await audit(req, "PAYOUT_HOLD_RELEASED", "USER", req.params.id, reason, { active: true }, { active: false }); return sendResponse(res, 200, "Payout hold released", { hold }); });

export const getOperationsDashboard = asyncHandler(async (_req, res) => {
  const now = new Date();
  const [messages, publications, appeals] = await Promise.all([
    MessageReport.find({ status: { $in: ["RECEIVED", "REVIEWING"] } }).select("reason priority dueAt createdAt reportedUser").lean(),
    PublicationReport.find({ status: { $in: ["RECEIVED", "REVIEWING"] } }).select("reason priority dueAt createdAt creator").lean(),
    ModerationAppeal.find().select("status createdAt reviewedAt").lean(),
  ]);
  const all = [...messages.map((r) => normalizedReport(r, "MessageReport")), ...publications.map((r) => normalizedReport(r, "PublicationReport"))];
  const [resolvedMessages, resolvedPublications] = await Promise.all([MessageReport.find({ resolvedAt: { $ne: null } }).select("createdAt resolvedAt").limit(5000).lean(), PublicationReport.find({ resolvedAt: { $ne: null } }).select("createdAt resolvedAt").limit(5000).lean()]);
  const times = [...resolvedMessages, ...resolvedPublications].map((r) => new Date(r.resolvedAt) - new Date(r.createdAt)).sort((a, b) => a - b);
  const medianMs = times.length ? times[Math.floor(times.length / 2)] : 0;
  const within24 = times.length ? Math.round(times.filter((x) => x <= 86400000).length / times.length * 100) : 100;
  const userCounts = new Map();
  for (const row of all) { const id = String(row.author?._id || row.author || ""); if (id) userCounts.set(id, (userCounts.get(id) || 0) + 1); }
  const leaders = [...userCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const people = await User.find({ _id: { $in: leaders.map(([id]) => id) } }).select("name username email status").lean();
  const peopleById = new Map(people.map((person) => [String(person._id), person]));
  const topReportedUsers = leaders.map(([userId, count]) => ({ userId, count, user: peopleById.get(userId) || null }));
  return sendResponse(res, 200, "Operations dashboard fetched", {
    reports: { open: all.length, urgent: all.filter((x) => x.priority === "URGENT").length, overdue: all.filter((x) => new Date(x.dueAt) < now).length, medianActionMinutes: Math.round(medianMs / 60000), within24Percent: within24 },
    appeals: { total: appeals.length, open: appeals.filter((x) => ["PENDING", "REVIEWING"].includes(x.status)).length, reversed: appeals.filter((x) => x.status === "REVERSED").length },
    topReportedUsers,
  });
});
