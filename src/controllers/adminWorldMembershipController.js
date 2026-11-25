import mongoose from "mongoose";
import Publication from "../models/Publication.js";
import PremiumMembership from "../models/PremiumMembership.js";
import MembershipPayment from "../models/MembershipPayment.js";
import Notification from "../models/Notification.js";
import GroupConversation from "../models/GroupConversation.js";
import AdminAuditEvent from "../models/AdminAuditEvent.js";
import { executeFinancialCommand } from "../services/financialCommandService.js";
import { refundMembershipPayment } from "../services/refundService.js";
import { fingerprint, idempotencyKey, requiredReason } from "../validators/financialValidator.js";
import { effectiveAdminRole } from "../middleware/adminPermissionMiddleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import ApiError from "../utils/ApiError.js";

const validId = (value, label = "ID") => { if (!mongoose.isObjectIdOrHexString(value)) throw new ApiError(400, `A valid ${label} is required`, "INVALID_ID"); return value; };
const escape = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const audit = (req, action, targetId, reason, before, after) => AdminAuditEvent.create({ actor: req.user._id, actorRole: effectiveAdminRole(req.user), action, targetType: "WORLD_MEMBERSHIP", targetId: String(targetId), reason, before, after });

export const listMembershipWorlds = asyncHandler(async (req, res) => {
  const search = String(req.query.search || "").trim();
  const filter = { kind: "PREMIUM_WORLD", ...(search ? { title: { $regex: escape(search), $options: "i" } } : {}) };
  const worlds = await Publication.find(filter).select("title creator status publishedSnapshot.metadata.pricing createdAt").populate("creator", "name username avatar").sort({ createdAt: -1 }).limit(100).lean();
  const ids = worlds.map((world) => world._id);
  const [members, payments] = await Promise.all([
    PremiumMembership.aggregate([{ $match: { premiumPublication: { $in: ids } } }, { $group: { _id: "$premiumPublication", total: { $sum: 1 }, active: { $sum: { $cond: [{ $in: ["$status", ["ACTIVE", "CANCEL_AT_PERIOD_END"]] }, 1, 0] } }, canceling: { $sum: { $cond: [{ $eq: ["$status", "CANCEL_AT_PERIOD_END"] }, 1, 0] } } } }]),
    MembershipPayment.aggregate([{ $match: { premiumPublication: { $in: ids } } }, { $group: { _id: "$premiumPublication", renewals: { $sum: { $cond: [{ $and: [{ $eq: ["$type", "RENEWAL"] }, { $eq: ["$status", "SUCCEEDED"] }] }, 1, 0] } }, failed: { $sum: { $cond: [{ $eq: ["$status", "FAILED"] }, 1, 0] } }, revenue: { $sum: { $cond: [{ $eq: ["$status", "SUCCEEDED"] }, "$amountStars", 0] } } } }]),
  ]);
  const memberMap = new Map(members.map((row) => [String(row._id), row])); const paymentMap = new Map(payments.map((row) => [String(row._id), row]));
  return sendResponse(res, 200, "Membership Worlds fetched", { items: worlds.map((world) => ({ ...world, metrics: { total: memberMap.get(String(world._id))?.total || 0, active: memberMap.get(String(world._id))?.active || 0, canceling: memberMap.get(String(world._id))?.canceling || 0, renewals: paymentMap.get(String(world._id))?.renewals || 0, failed: paymentMap.get(String(world._id))?.failed || 0, revenue: paymentMap.get(String(world._id))?.revenue || 0 } })) });
});

export const getWorldMemberships = asyncHandler(async (req, res) => {
  const worldId = validId(req.params.worldId, "World ID"); const page = Math.max(1, Number(req.query.page) || 1); const limit = Math.min(100, Math.max(10, Number(req.query.limit) || 25));
  const world = await Publication.findOne({ _id: worldId, kind: "PREMIUM_WORLD" }).select("title creator status publishedSnapshot.metadata.pricing worldSeatCapacity").populate("creator", "name username avatar email").lean();
  if (!world) throw new ApiError(404, "Premium World not found", "WORLD_NOT_FOUND");
  const filter = { premiumPublication: worldId }; const status = String(req.query.status || "").toUpperCase(); if (status) filter.status = status;
  const search = String(req.query.search || "").trim();
  if (search) { const users = await mongoose.model("User").find({ $or: ["name", "username", "email"].map((field) => ({ [field]: { $regex: escape(search), $options: "i" } })) }).select("_id").limit(500).lean(); filter.user = { $in: users.map((user) => user._id) }; }
  const [rows, total, statusCounts, paymentCounts] = await Promise.all([
    PremiumMembership.find(filter).populate("user", "name username email avatar status").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    PremiumMembership.countDocuments(filter), PremiumMembership.aggregate([{ $match: { premiumPublication: world._id } }, { $group: { _id: "$status", count: { $sum: 1 }, recurring: { $sum: { $cond: [{ $in: ["$status", ["ACTIVE", "CANCEL_AT_PERIOD_END"]] }, "$starsPerPeriod", 0] } } } }]),
    MembershipPayment.aggregate([{ $match: { premiumPublication: world._id } }, { $group: { _id: "$status", count: { $sum: 1 }, stars: { $sum: "$amountStars" }, renewals: { $sum: { $cond: [{ $eq: ["$type", "RENEWAL"] }, 1, 0] } } } }]),
  ]);
  const membershipIds = rows.map((row) => row._id); const payments = await MembershipPayment.find({ membership: { $in: membershipIds } }).sort({ attemptedAt: -1 }).lean();
  const byMembership = new Map(); for (const payment of payments) byMembership.set(String(payment.membership), [...(byMembership.get(String(payment.membership)) || []), payment]);
  const counts = Object.fromEntries(statusCounts.map((row) => [row._id, row.count])); const pay = Object.fromEntries(paymentCounts.map((row) => [row._id, row]));
  return sendResponse(res, 200, "World memberships fetched", { world, summary: { total: statusCounts.reduce((sum, row) => sum + row.count, 0), active: (counts.ACTIVE || 0) + (counts.CANCEL_AT_PERIOD_END || 0), canceling: counts.CANCEL_AT_PERIOD_END || 0, canceled: (counts.CANCELED || 0) + (counts.EXPIRED || 0), refunded: counts.REFUNDED || 0, renewals: pay.SUCCEEDED?.renewals || 0, failedPayments: pay.FAILED?.count || 0, recurringStars: statusCounts.reduce((sum, row) => sum + (row.recurring || 0), 0), collectedStars: pay.SUCCEEDED?.stars || 0 }, items: rows.map((row) => ({ ...row, payments: byMembership.get(String(row._id)) || [] })), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

export const adminCancelMembership = asyncHandler(async (req, res) => {
  const membershipId = validId(req.params.id, "membership ID"); const reason = requiredReason(req.body.reason); const immediate = req.body.immediate === true; const key = idempotencyKey(req.body.idempotencyKey);
  const before = await PremiumMembership.findById(membershipId).select("status cancelAtPeriodEnd currentPeriodEnd").lean(); if (!before) throw new ApiError(404, "Membership not found", "MEMBERSHIP_NOT_FOUND");
  const result = await executeFinancialCommand({ user: req.user._id, commandType: "ADMIN_CANCEL_PREMIUM", idempotencyKey: key, requestFingerprint: fingerprint({ membershipId: String(membershipId), reason, immediate }) }, async (session) => {
    const membership = await PremiumMembership.findById(membershipId).session(session); if (!membership) throw new ApiError(404, "Membership not found", "MEMBERSHIP_NOT_FOUND");
    if (!["ACTIVE", "CANCEL_AT_PERIOD_END"].includes(membership.status)) throw new ApiError(409, "Membership is no longer active", "MEMBERSHIP_EXPIRED");
    if (immediate) { membership.status = "CANCELED"; membership.cancelAtPeriodEnd = false; membership.canceledAt = new Date(); membership.endedAt = new Date(); membership.activeMembershipKey = undefined; await GroupConversation.updateMany({ premiumWorld: membership.premiumPublication, isWorldCircle: true }, { $pull: { members: membership.user } }, { session }); }
    else { membership.status = "CANCEL_AT_PERIOD_END"; membership.cancelAtPeriodEnd = true; membership.canceledAt = new Date(); }
    membership.membershipVersion += 1; await membership.save({ session });
    await Notification.create([{ user: membership.user, actor: req.user._id, type: "premium_membership_admin_cancelled", title: immediate ? "World membership ended" : "World membership will end", message: immediate ? `An administrator ended your membership. Reason: ${reason}` : `Your membership will end on ${membership.currentPeriodEnd.toLocaleDateString("en-US", { timeZone: "UTC" })}. Reason: ${reason}`, target: { type: "PREMIUM_WORLD", id: membership.premiumPublication }, dedupeKey: `admin-membership-cancel:${key}` }], { session });
    return { resultReference: membership._id, membership: { id: membership._id, status: membership.status, cancelAtPeriodEnd: membership.cancelAtPeriodEnd, endedAt: membership.endedAt, currentPeriodEnd: membership.currentPeriodEnd } };
  });
  await audit(req, "ADMIN_CANCEL_WORLD_MEMBERSHIP", membershipId, reason, before, result.membership); return sendResponse(res, 200, immediate ? "Membership ended" : "Membership will cancel at period end", result);
});

export const adminRefundMembershipPayment = asyncHandler(async (req, res) => {
  const paymentId = validId(req.params.id, "payment ID"); const reason = requiredReason(req.body.reason); const result = await refundMembershipPayment({ admin: req.user, paymentId, key: req.body.idempotencyKey, reason, endAccess: req.body.endAccess !== false });
  await audit(req, "REFUND_WORLD_MEMBERSHIP_PAYMENT", paymentId, reason, null, result.payment); return sendResponse(res, 200, "Membership payment refunded", result);
});
