import mongoose from "mongoose";
import Content from "../models/Content.js";
import Subscription from "../models/Subscription.js";
import User from "../models/User.js";
import MessageReport from "../models/MessageReport.js";
import Notification from "../models/Notification.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

export const getAdminDashboard = asyncHandler(async (_req, res) => {
  const [totalUsers, fans, creators, admins, activeUsers, pendingCreators, publishedContent, draftContent, activeSubscriptions] =
    await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: "fan" }),
      User.countDocuments({ role: { $in: ["fan", "creator"] }, creatorApprovalStatus: "approved" }),
      User.countDocuments({ role: "admin" }),
      User.countDocuments({ status: "active" }),
      User.countDocuments({ role: { $in: ["fan", "creator"] }, creatorApprovalStatus: "pending" }),
      Content.countDocuments({ status: { $in: ["PUBLISHED", "published"] } }),
      Content.countDocuments({ status: { $in: ["DRAFT", "draft"] } }),
      Subscription.countDocuments({ status: "active" }),
    ]);

  return sendResponse(res, 200, "Admin dashboard fetched", {
    stats: { totalUsers, fans, creators, admins, activeUsers, pendingCreators, publishedContent, draftContent, activeSubscriptions },
  });
});

export const listUsers = asyncHandler(async (req, res) => {
  const filter = {};
  if (["fan", "creator", "admin"].includes(req.query.role)) filter.role = req.query.role;
  if (["active", "suspended"].includes(req.query.status)) filter.status = req.query.status;

  const users = await User.find(filter)
    .select("name username email role status creatorApprovalStatus isVerified avatar createdAt")
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

  const user = await User.findByIdAndUpdate(
    req.params.userId,
    { $set: { status: req.body.status } },
    { new: true, runValidators: true }
  ).select("name username email role status creatorApprovalStatus isVerified avatar createdAt");
  if (!user) throw new ApiError(404, "User not found");

  return sendResponse(res, 200, "User status updated", { user });
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
  const managesAccountRestrictions = req.reportScopes?.some((scope) => ["FEED_POST", "PROFILE", "SEEN"].includes(scope));
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
  return sendResponse(res, 200, "Report fetched", { report });
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
  if (!["NO_ACTION", "WARNING", "MESSAGING_RESTRICTED", "ACCOUNT_RESTRICTED", "RESTRICTION_LIFTED"].includes(action)) throw new ApiError(400, "Select a valid moderation action");
  if (!note || note.length > 2000) throw new ApiError(400, "A moderation note between 1 and 2,000 characters is required");
  const report = await MessageReport.findById(req.params.reportId);
  if (!report) throw new ApiError(404, "Report not found");
  if (req.reportScopes?.length && !req.reportScopes.includes(report.scope)) throw new ApiError(404, "Report not found");
  const isUserReport = ["FEED_POST", "PROFILE", "SEEN"].includes(report.scope);
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
  report.resolution = { action, note, restrictionUntil };
  await report.save();
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


