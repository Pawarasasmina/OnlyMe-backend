import { withMessageEvidenceUrls } from "../services/messageEvidenceService.js";
import { assertAccountAge } from "../utils/accountAge.js";
import mongoose from "mongoose";
import Content from "../models/Content.js";
import Publication from "../models/Publication.js";
import FeedPost from "../models/FeedPost.js";
import WallPost from "../models/WallPost.js";
import Subscription from "../models/Subscription.js";
import PremiumMembership from "../models/PremiumMembership.js";
import Story from "../models/Story.js";
import User from "../models/User.js";
import MessageReport from "../models/MessageReport.js";
import Notification from "../models/Notification.js";
import AdminAuditEvent from "../models/AdminAuditEvent.js";
import { requireAccountAction } from "../validators/accountActionValidator.js";
import { ACCOUNT_TYPES, normalizeAccountType } from "../constants/accountTypeConstants.js";
import { storyExpiresAt } from "../services/storyExpiryService.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { effectiveAdminRole } from "../middleware/adminPermissionMiddleware.js";
import { CURRENT_ACCOUNT_FILTER } from "../constants/currentAccountScope.js";
import { applyResolvedCaseStrike } from "../services/moderationEnforcementService.js";

export const getAdminDashboard = asyncHandler(async (_req, res) => {
  const platformUserIds = await User.distinct("_id", CURRENT_ACCOUNT_FILTER);
  const platformUserFilter = { ...CURRENT_ACCOUNT_FILTER, _id: { $in: platformUserIds } };
  const creatorFilter = { $in: platformUserIds };
  const now = new Date();
  const [totalUsers, fans, creators, admins, activeUsers, pendingCreators, legacyPublished, publicationsPublished, feedPostsPublished, wallPostsPublished, storiesPublished, legacyDrafts, publicationDrafts, feedPostDrafts, legacySubscriptions, premiumMemberships, accountTypeRows] =
    await Promise.all([
      User.countDocuments(platformUserFilter),
      User.countDocuments({ ...platformUserFilter, role: { $in: ["fan", "creator"] }, creatorApprovalStatus: { $ne: "approved" } }),
      User.countDocuments({ ...platformUserFilter, role: { $in: ["fan", "creator"] }, creatorApprovalStatus: "approved" }),
      User.countDocuments({ ...platformUserFilter, role: "admin" }),
      User.countDocuments({ ...platformUserFilter, status: "active" }),
      User.countDocuments({ ...platformUserFilter, role: { $in: ["fan", "creator"] }, creatorApprovalStatus: "pending" }),
      Content.countDocuments({ creator: creatorFilter, status: { $in: ["PUBLISHED", "published"] } }),
      Publication.countDocuments({ creator: creatorFilter, status: "PUBLISHED" }),
      FeedPost.countDocuments({ author: creatorFilter, status: "published", deletedAt: null }),
      WallPost.countDocuments({ creator: creatorFilter, status: "PUBLISHED" }),
      Story.countDocuments({ creator: creatorFilter }),
      Content.countDocuments({ creator: creatorFilter, status: { $in: ["DRAFT", "draft"] } }),
      Publication.countDocuments({ creator: creatorFilter, status: "DRAFT" }),
      FeedPost.countDocuments({ author: creatorFilter, status: "draft", deletedAt: null }),
      Subscription.countDocuments({ fan: creatorFilter, status: "active", $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }),
      PremiumMembership.countDocuments({ user: creatorFilter, status: { $in: ["ACTIVE", "CANCEL_AT_PERIOD_END"] }, currentPeriodEnd: { $gt: now } }),
      User.aggregate([{ $match: CURRENT_ACCOUNT_FILTER }, { $group: { _id: { $ifNull: ["$accountType", "SEED"] }, count: { $sum: 1 } } }]),
    ]);

  const contentBreakdown = { legacy: legacyPublished, publications: publicationsPublished, wall: feedPostsPublished + wallPostsPublished, stories: storiesPublished };
  const draftBreakdown = { legacy: legacyDrafts, publications: publicationDrafts, wall: feedPostDrafts };
  const subscriptionBreakdown = { legacy: legacySubscriptions, premium: premiumMemberships };

  return sendResponse(res, 200, "Admin dashboard fetched", {
    stats: {
      scope: "ALL_CURRENT_ACCOUNTS",
      generatedAt: now,
      totalUsers, fans, creators, admins, activeUsers, pendingCreators,
      publishedContent: Object.values(contentBreakdown).reduce((sum, value) => sum + value, 0),
      draftContent: Object.values(draftBreakdown).reduce((sum, value) => sum + value, 0),
      activeSubscriptions: Object.values(subscriptionBreakdown).reduce((sum, value) => sum + value, 0),
      contentBreakdown, draftBreakdown, subscriptionBreakdown,
      accountTypes: Object.fromEntries(accountTypeRows.map((row) => [row._id, row.count])),
    },
  });
});

export const listUsers = asyncHandler(async (req, res) => {
  const filter = { ...CURRENT_ACCOUNT_FILTER };
  if (effectiveAdminRole(req.user) !== "MAIN_ADMIN") filter.role = { $ne: "admin" };
  if (req.query.role === "creator") {
    filter.role = { $in: ["fan", "creator"] };
    filter.creatorApprovalStatus = "approved";
  } else if (req.query.role === "fan") {
    filter.role = { $in: ["fan", "creator"] };
    filter.creatorApprovalStatus = { $ne: "approved" };
  } else if (req.query.role === "admin") {
    if (effectiveAdminRole(req.user) !== "MAIN_ADMIN") throw new ApiError(403, "Only Main Admins can view staff accounts");
    filter.role = "admin";
  }
  if (["active", "suspended"].includes(req.query.status)) filter.status = req.query.status;
  if (["personal", "creator", "business"].includes(req.query.profileAccountType)) {
    filter.$and = [...(filter.$and || []), { $or: [{ profileAccountType: req.query.profileAccountType }, { profileAccountType: { $in: [null, ""] }, profileType: req.query.profileAccountType }] }];
  }
  const requestedAccountType = String(req.query.accountType || "").toUpperCase();
  if (ACCOUNT_TYPES.includes(requestedAccountType)) filter.accountType = requestedAccountType;
  const search = String(req.query.search || "").trim().replace(/^@/, "");
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [{ name: { $regex: escaped, $options: "i" } }, { username: { $regex: escaped, $options: "i" } }, { email: { $regex: escaped, $options: "i" } }, { phone: { $regex: escaped, $options: "i" } }, ...(mongoose.isValidObjectId(search) ? [{ _id: search }] : [])];
  }

  const users = await User.find(filter)
    .select("+accountType name username email phone dateOfBirth profileAccountType profileType profileCategory role status creatorApprovalStatus isVerified avatar createdAt")
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  return sendResponse(res, 200, "Users fetched", { users });
});

export const updateUserStatus = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.userId)) throw new ApiError(400, "Invalid user ID");
  if (!["active", "suspended"].includes(req.body.status)) {
    throw new ApiError(400, "Status must be active or suspended");
  }
  if (req.params.userId === req.user._id.toString()) {
    throw new ApiError(400, "You cannot change your own account status");
  }

  const reason = requireAccountAction(req.body);
  const previous = await User.findById(req.params.userId).select("status role dateOfBirth");
  if (previous?.role === "admin") throw new ApiError(403, "Manage staff accounts from Admin team & access");
  if (req.body.status === "active" && previous) assertAccountAge(previous);
  const user = await User.findByIdAndUpdate(req.params.userId, { $set: { status: req.body.status } }, { new: true, runValidators: true }).select("+accountType name username email role status creatorApprovalStatus isVerified avatar createdAt");
  if (!user) throw new ApiError(404, "User not found");
  await AdminAuditEvent.create({ actor: req.user._id, actorRole: effectiveAdminRole(req.user), targetType: "USER", targetId: String(user._id), action: "ACCOUNT_STATUS_CHANGED", before: { status: previous?.status }, after: { status: user.status }, reason });

  return sendResponse(res, 200, "User status updated", { user });
});

export const bulkUpdateUsers = asyncHandler(async (req, res) => {
  const ids = [...new Set((Array.isArray(req.body.userIds) ? req.body.userIds : []).map(String))];
  if (!ids.length || ids.length > 200 || ids.some((id) => !mongoose.isValidObjectId(id))) throw new ApiError(400, "Choose between 1 and 200 valid user IDs");
  if (ids.includes(String(req.user._id))) throw new ApiError(400, "You cannot bulk-change your own administrator account");
  const accountType = req.body.accountType == null ? null : String(req.body.accountType).toUpperCase();
  const status = req.body.status == null ? null : String(req.body.status).toLowerCase();
  if (accountType && !ACCOUNT_TYPES.includes(accountType)) throw new ApiError(400, "Account type must be REAL, SEED, or TEST");
  if (status && !["active", "suspended"].includes(status)) throw new ApiError(400, "Status must be active or suspended");
  if (!accountType && !status) throw new ApiError(400, "Choose an account type or status to update");
  const reason = requireAccountAction(req.body);
  const users = await User.find({ _id: { $in: ids }, role: { $ne: "admin" } }).select("+accountType status role dateOfBirth");
  if (users.length !== ids.length) throw new ApiError(404, "One or more users were not found");
  if (status === "active") users.forEach(assertAccountAge);
  const update = { ...(accountType ? { accountType } : {}), ...(status ? { status } : {}) };
  await User.updateMany({ _id: { $in: ids } }, { $set: update }, { runValidators: true });
  if (accountType) {
    const nextExpiry = storyExpiresAt(accountType);
    await Story.updateMany(
      accountType === "TEST" ? { creator: { $in: ids } } : { creator: { $in: ids }, expiresAt: { $gt: nextExpiry } },
      { $set: { expiresAt: nextExpiry } },
    );
  }
  await AdminAuditEvent.insertMany(users.map((user) => ({
    actor: req.user._id, actorRole: effectiveAdminRole(req.user), targetType: "USER", targetId: String(user._id),
    action: status && accountType ? "ACCOUNT_UPDATED" : status ? "ACCOUNT_STATUS_CHANGED" : "ACCOUNT_TYPE_CHANGED",
    before: { status: user.status, accountType: normalizeAccountType(user.accountType) },
    after: { status: status || user.status, accountType: accountType || normalizeAccountType(user.accountType) }, reason,
    metadata: { bulk: true },
  })));
  return sendResponse(res, 200, "Accounts updated", { matched: users.length, modified: users.filter((user) => (accountType && normalizeAccountType(user.accountType) !== accountType) || (status && user.status !== status)).length });
});

export const updateCreatorApproval = asyncHandler(async (_req, _res) => {
  throw new ApiError(410, "Direct creator approval is disabled. Use the creator verification review endpoint.");
});

export const listContentForModeration = asyncHandler(async (_req, res) => {
  const items = await Content.find()
    .sort({ createdAt: -1 })
    .limit(200)
    .populate("creator", "name username avatar")
    .lean();
  return sendResponse(res, 200, "Content moderation list fetched", { items });
});

export const updateContentStatus = asyncHandler(async (_req, _res) => {
  throw new ApiError(410, "Direct status changes are disabled. Use the manual content moderation endpoints.");
});

const reportUserFields = "name username email role avatar status loginRestrictedUntil loginRestrictionReason messagingRestrictedUntil messagingRestrictionReason";
const REPORT_STATUSES = new Set(["RECEIVED", "REVIEWING", "RESOLVED", "CLOSED"]);
const RESTRICTION_DURATIONS = new Map([
  ["1_HOUR", 60 * 60 * 1000],
  ["5_HOURS", 5 * 60 * 60 * 1000],
  ["24_HOURS", 24 * 60 * 60 * 1000],
  ["7_DAYS", 7 * 24 * 60 * 60 * 1000],
  ["30_DAYS", 30 * 24 * 60 * 60 * 1000],
]);

export const listMessageReports = asyncHandler(async (req, res) => {
  const filter = req.reportScopes?.length ? { scope: { $in: req.reportScopes } } : {};
  const status = String(req.query.status || "").toUpperCase();
  if (status && REPORT_STATUSES.has(status)) filter.status = status;
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
  const [items, total, received, reviewing, resolved] = await Promise.all([
    MessageReport.find(filter).select("+snapshot").populate("reporter", reportUserFields).populate("reportedUser", reportUserFields).populate("reviewedBy", "name username email").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    MessageReport.countDocuments(filter),
    MessageReport.countDocuments({ ...filter, status: "RECEIVED" }),
    MessageReport.countDocuments({ ...filter, status: "REVIEWING" }),
    MessageReport.countDocuments({ ...filter, status: { $in: ["RESOLVED", "CLOSED"] } }),
  ]);
  return sendResponse(res, 200, "Message reports fetched", {
    items,
    summary: { received, reviewing, resolved, total: received + reviewing + resolved },
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  });
});

export const listReportedMessageUsers = asyncHandler(async (req, res) => {
  const groups = await MessageReport.aggregate([
    ...(req.reportScopes?.length ? [{ $match: { scope: { $in: req.reportScopes } } }] : []),
    { $sort: { createdAt: 1 } },
    {
      $group: {
        _id: "$reportedUser",
        totalReports: { $sum: 1 },
        received: { $sum: { $cond: [{ $eq: ["$status", "RECEIVED"] }, 1, 0] } },
        reviewing: { $sum: { $cond: [{ $eq: ["$status", "REVIEWING"] }, 1, 0] } },
        resolved: { $sum: { $cond: [{ $in: ["$status", ["RESOLVED", "CLOSED"]] }, 1, 0] } },
        warnings: { $sum: { $cond: [{ $eq: ["$resolution.action", "WARNING"] }, 1, 0] } },
        restrictions: { $sum: { $cond: [{ $in: ["$resolution.action", ["ACCOUNT_RESTRICTED", "MESSAGING_RESTRICTED"]] }, 1, 0] } },
        categories: { $push: "$reason" },
        lastReportedAt: { $max: "$createdAt" },
        latestReason: { $last: "$reason" },
      },
    },
    { $sort: { received: -1, reviewing: -1, lastReportedAt: -1 } },
  ]);
  const users = await User.find({ _id: { $in: groups.map((item) => item._id) } }).select(reportUserFields).lean();
  const byId = new Map(users.map((user) => [String(user._id), user]));
  const items = groups.flatMap((group) => {
    const user = byId.get(String(group._id));
    if (!user) return [];
    const categoryCounts = group.categories.reduce((counts, category) => ({ ...counts, [category]: (counts[category] || 0) + 1 }), {});
    return [{ ...group, categoryCounts, categories: undefined, user }];
  });
  const managesAccountRestrictions = req.reportScopes?.some((scope) => ["FEED_POST", "PROFILE", "SEEN", "WORLD"].includes(scope));
  const summary = items.reduce((totals, item) => ({
    users: totals.users + 1,
    reports: totals.reports + item.totalReports,
    open: totals.open + item.received + item.reviewing,
    restricted: totals.restricted + ((managesAccountRestrictions ? item.user.loginRestrictedUntil : item.user.messagingRestrictedUntil) && new Date(managesAccountRestrictions ? item.user.loginRestrictedUntil : item.user.messagingRestrictedUntil) > new Date() ? 1 : 0),
  }), { users: 0, reports: 0, open: 0, restricted: 0 });
  return sendResponse(res, 200, "Reported message users fetched", { items, summary });
});

export const getReportedMessageUser = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.userId)) throw new ApiError(400, "Invalid user ID");
  const [user, reports] = await Promise.all([
    User.findById(req.params.userId).select(reportUserFields).lean(),
    MessageReport.find({ reportedUser: req.params.userId, ...(req.reportScopes?.length ? { scope: { $in: req.reportScopes } } : {}) }).select("+snapshot").populate("reporter", reportUserFields).populate("reportedUser", reportUserFields).populate("publication", "title summary coverMedia publishedAt").populate("reviewedBy", "name username email").sort({ createdAt: -1 }).lean(),
  ]);
  if (!user) throw new ApiError(404, "Reported user not found");
  const history = reports.filter((report) => report.resolution?.action).map((report) => ({
    reportId: report._id,
    action: report.resolution.action,
    note: report.resolution.note,
    restrictionUntil: report.resolution.restrictionUntil,
    restrictionLiftedAt: report.resolution.restrictionLiftedAt,
    restrictionLiftNote: report.resolution.restrictionLiftNote,
    resolvedAt: report.resolvedAt,
    reviewedBy: report.reviewedBy,
  }));
  return sendResponse(res, 200, "Reported message user fetched", { user, reports, history });
});

export const getReportForModeration = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.reportId)) throw new ApiError(400, "Invalid report ID");
  const report = await MessageReport.findOne({ _id: req.params.reportId, ...(req.reportScopes?.length ? { scope: { $in: req.reportScopes } } : {}) })
    .select("+snapshot")
    .populate("reporter", reportUserFields)
    .populate("reportedUser", reportUserFields)
    .populate("publication", "title summary coverMedia publishedAt")
    .populate("reviewedBy", "name username email")
    .lean();
  if (!report) throw new ApiError(404, "Report not found");
  return sendResponse(res, 200, "Report fetched", { report: withMessageEvidenceUrls(report) });
});

export const startMessageReportReview = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.reportId)) throw new ApiError(400, "Invalid report ID");
  const report = await MessageReport.findOneAndUpdate(
    { _id: req.params.reportId, status: { $in: ["RECEIVED", "REVIEWING"] }, ...(req.reportScopes?.length ? { scope: { $in: req.reportScopes } } : {}) },
    { $set: { status: "REVIEWING", reviewedBy: req.user._id, reviewingAt: new Date() } },
    { new: true },
  ).populate("reviewedBy", "name username email");
  if (!report) throw new ApiError(404, "Open report not found");
  return sendResponse(res, 200, "Report review started", { report });
});

export const resolveMessageReport = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.reportId)) throw new ApiError(400, "Invalid report ID");
  const action = String(req.body.action || "").toUpperCase();
  const note = String(req.body.note || "").trim();
  if (!["NO_ACTION", "HIDDEN", "REMOVED", "WARNING", "MESSAGING_RESTRICTED", "ACCOUNT_RESTRICTED", "RESTRICTION_LIFTED"].includes(action)) throw new ApiError(400, "Select a valid moderation action");
  if (!note || note.length > 2000) throw new ApiError(400, "A moderation note between 1 and 2,000 characters is required");
  const report = await MessageReport.findById(req.params.reportId);
  if (!report) throw new ApiError(404, "Report not found");
  if (req.reportScopes?.length && !req.reportScopes.includes(report.scope)) throw new ApiError(404, "Report not found");
  if (req.body.falseReport != null && typeof req.body.falseReport !== "boolean") throw new ApiError(400, "False report must be true or false");
  if (req.body.falseReport && (action !== "NO_ACTION" || report.scope !== "FEED_POST" || report.source !== "USER_REPORT")) throw new ApiError(400, "Only a reviewed Wall user report dismissed with no action can be confirmed false");
  if (["HIDDEN", "REMOVED"].includes(action) && report.scope !== "FEED_POST") throw new ApiError(400, "This action is available for Wall notes");
  const isUserReport = ["FEED_POST", "PROFILE", "SEEN", "WORLD"].includes(report.scope);
  if (action === "ACCOUNT_RESTRICTED" && !isUserReport) throw new ApiError(400, "Account restrictions must be applied from User reports");
  if (action === "MESSAGING_RESTRICTED" && isUserReport) throw new ApiError(400, "Messaging restrictions must be applied from Message reports");
  if (["RESOLVED", "CLOSED"].includes(report.status) && action !== "RESTRICTION_LIFTED") throw new ApiError(409, "This report is already resolved");

  let restrictionUntil = null;
  if (action === "ACCOUNT_RESTRICTED" || action === "MESSAGING_RESTRICTED") {
    const duration = String(req.body.duration || "").toUpperCase();
    const milliseconds = RESTRICTION_DURATIONS.get(duration);
    if (!milliseconds) throw new ApiError(400, "Select a valid restriction duration");
    restrictionUntil = new Date(Date.now() + milliseconds);
    const restriction = action === "ACCOUNT_RESTRICTED"
      ? { loginRestrictedUntil: restrictionUntil, loginRestrictionReason: note, loginRestrictedBy: req.user._id }
      : { messagingRestrictedUntil: restrictionUntil, messagingRestrictionReason: note, messagingRestrictedBy: req.user._id };
    await User.findByIdAndUpdate(report.reportedUser, { $set: restriction });
  } else if (action === "RESTRICTION_LIFTED") {
    const accountRestriction = report.resolution?.action === "ACCOUNT_RESTRICTED";
    await User.findByIdAndUpdate(report.reportedUser, {
      $set: accountRestriction
        ? { loginRestrictedUntil: null, loginRestrictionReason: "", loginRestrictedBy: null }
        : { messagingRestrictedUntil: null, messagingRestrictionReason: "", messagingRestrictedBy: null },
    });
    report.resolution.restrictionLiftedAt = new Date();
    report.resolution.restrictionLiftedBy = req.user._id;
    report.resolution.restrictionLiftNote = note;
    await report.save();
    req.app.get("io")?.to(`user:${report.reportedUser}`).emit(accountRestriction ? "account:restriction" : "messaging:restriction", {
      restrictedUntil: null,
      active: false,
    });
    await report.populate([{ path: "reporter", select: reportUserFields }, { path: "reportedUser", select: reportUserFields }, { path: "reviewedBy", select: "name username email" }]);
    return sendResponse(res, 200, "Restriction lifted", { report });
  }

  report.status = "RESOLVED";
  report.reviewedBy = req.user._id;
  report.reviewingAt ||= new Date();
  report.resolvedAt = new Date();
  report.resolution = { action, note, restrictionUntil, falseReport: Boolean(req.body.falseReport) };
  if (["HIDDEN", "REMOVED"].includes(action)) {
    const { default: FeedPost } = await import("../models/FeedPost.js");
    await FeedPost.updateOne({ _id: report.feedPost }, { $set: { status: action === "REMOVED" ? "deleted" : "archived", ...(report.source !== "AUTOMATED_DUPLICATE" ? { moderationStatus: "REJECTED" } : {}), ...(action === "REMOVED" ? { deletedAt: new Date() } : { archivedAt: new Date() }) } });
  }
  await report.save();
  const strike = await applyResolvedCaseStrike({ report, reportModel: "MessageReport", actorId: req.user._id, io: req.app.get("io") });
  if (strike) {
    report.resolution.strike = strike._id;
    report.resolution.strikeNumber = strike.strikeNumberAtIssue;
    report.resolution.automaticConsequence = strike.automaticConsequence;
    await report.save();
  }
  if (action === "WARNING") {
    await Notification.updateOne(
      { dedupeKey: `moderation-warning:${report._id}` },
      { $setOnInsert: {
        user: report.reportedUser,
        type: "moderation_warning",
        title: "Important account warning",
        message: "Your account has been reported. Please follow our community rules and behave responsibly. Further violations may result in your account being temporarily restricted or suspended.",
        severity: "critical",
        priority: 100,
        relatedReport: report._id,
        dedupeKey: `moderation-warning:${report._id}`,
      } },
      { upsert: true },
    );
  }
  req.app.get("io")?.to(`user:${report.reportedUser}`).emit(action === "ACCOUNT_RESTRICTED" ? "account:restriction" : "messaging:restriction", {
    restrictedUntil: restrictionUntil,
    active: action === "ACCOUNT_RESTRICTED",
  });
  await report.populate([{ path: "reporter", select: reportUserFields }, { path: "reportedUser", select: reportUserFields }, { path: "reviewedBy", select: "name username email" }]);
  return sendResponse(res, 200, "Report resolved", { report });
});
