import mongoose from "mongoose";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import VerifiedCreatorSubscription from "../models/VerifiedCreatorSubscription.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { expireVerifiedCreator, getVerifiedCreatorPlan, payVerifiedCreator, updateVerifiedCreatorPlan } from "../services/verifiedCreatorService.js";

const clean = (value, limit = 2000) => String(value || "").trim().slice(0, limit);
const view = (item) => item ? ({ id: item._id, status: item.status, starsPerMonth: item.starsPerMonth, autoRenew: item.autoRenew, statement: item.statement, submittedAt: item.submittedAt, reviewedAt: item.reviewedAt, creatorMessage: item.creatorMessage, currentPeriodStart: item.currentPeriodStart, currentPeriodEnd: item.currentPeriodEnd, lastPaidAt: item.lastPaidAt, paymentStatus: item.paymentStatus, creator: item.creator }) : null;

export const getMyVerifiedCreator = asyncHandler(async (req, res) => {
  await expireVerifiedCreator(req.user._id);
  const [subscription, plan, user] = await Promise.all([VerifiedCreatorSubscription.findOne({ creator: req.user._id }).lean(), getVerifiedCreatorPlan(), User.findById(req.user._id).select("isVerified").lean()]);
  return sendResponse(res, 200, "Verified Creator status fetched", { subscription: view(subscription), plan, isVerified: Boolean(user?.isVerified) });
});

export const applyForVerifiedCreator = asyncHandler(async (req, res) => {
  if (req.user.creatorApprovalStatus !== "approved") throw new ApiError(403, "Only approved creators can apply for Verified Creator");
  const statement = clean(req.body.statement, 1000);
  if (statement.length < 20) throw new ApiError(400, "Tell us why your account should be verified (at least 20 characters)");
  const existing = await VerifiedCreatorSubscription.findOne({ creator: req.user._id });
  if (existing && ["PENDING", "APPROVED"].includes(existing.status)) throw new ApiError(409, existing.status === "PENDING" ? "Your Verified Creator application is already under review" : "Your Verified Creator subscription is already active");
  const plan = await getVerifiedCreatorPlan();
  const subscription = await VerifiedCreatorSubscription.findOneAndUpdate(
    { creator: req.user._id },
    { $set: { status: "PENDING", statement, submittedAt: new Date(), reviewedAt: null, reviewedBy: null, adminNote: "", creatorMessage: "", starsPerMonth: plan.starsPerMonth, autoRenew: req.body.autoRenew !== false, paymentStatus: "NOT_STARTED" }, $setOnInsert: { creator: req.user._id } },
    { new: true, upsert: true, runValidators: true }
  );
  return sendResponse(res, 201, "Verified Creator application submitted", { subscription: view(subscription) });
});

export const renewVerifiedCreator = asyncHandler(async (req, res) => {
  const result = await payVerifiedCreator({ userId: req.user._id, key: req.body.idempotencyKey });
  return sendResponse(res, 200, "Verified Creator Stars payment completed", result);
});

export const listVerifiedCreatorApplications = asyncHandler(async (req, res) => {
  const filter = req.query.status ? { status: String(req.query.status).toUpperCase() } : {};
  const items = await VerifiedCreatorSubscription.find(filter).populate("creator", "name username email avatar isVerified creatorApprovalStatus").sort({ submittedAt: -1 }).limit(250).lean();
  return sendResponse(res, 200, "Verified Creator applications fetched", { items: items.map(view), plan: await getVerifiedCreatorPlan() });
});

export const updateVerifiedCreatorPrice = asyncHandler(async (req, res) => {
  const plan = await updateVerifiedCreatorPlan(req.body.starsPerMonth, req.user._id);
  return sendResponse(res, 200, "Verified Creator monthly price updated", { plan });
});

async function decide(req, res, status) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid application ID");
  const subscription = await VerifiedCreatorSubscription.findById(req.params.id);
  if (!subscription) throw new ApiError(404, "Verified Creator application not found");
  if (subscription.status !== "PENDING") throw new ApiError(409, "This application has already been reviewed");
  const now = new Date();
  subscription.status = status; subscription.reviewedAt = now; subscription.reviewedBy = req.user._id; subscription.adminNote = clean(req.body.adminNote); subscription.creatorMessage = clean(req.body.creatorMessage) || (status === "APPROVED" ? "Your Verified Creator application was approved. Complete the monthly renewal to keep your blue tick active." : "Your Verified Creator application was not approved.");
  if (status === "APPROVED") subscription.paymentStatus = "NOT_STARTED";
  await Promise.all([subscription.save(), User.updateOne({ _id: subscription.creator }, { $set: { isVerified: false } }), Notification.create({ user: subscription.creator, type: status === "APPROVED" ? "verified_creator_approved" : "verified_creator_rejected", title: status === "APPROVED" ? "Verified Creator approved — activate with Stars" : "Verified Creator application update", message: subscription.creatorMessage, severity: status === "APPROVED" ? "info" : "warning", priority: 60 })]);
  return sendResponse(res, 200, `Verified Creator application ${status.toLowerCase()}`, { subscription: view(subscription) });
}

export const approveVerifiedCreator = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid application ID");
  const subscription = await VerifiedCreatorSubscription.findById(req.params.id);
  if (!subscription) throw new ApiError(404, "Verified Creator application not found");
  if (subscription.status !== "PENDING") throw new ApiError(409, "This application has already been reviewed");

  const result = await payVerifiedCreator({ userId: subscription.creator, key: `verified-approval:${subscription._id}` });
  const creatorMessage = clean(req.body.creatorMessage) || "Your Verified Creator application was approved, your monthly Stars payment was completed, and your blue tick is now active.";
  await Promise.all([
    VerifiedCreatorSubscription.updateOne({ _id: subscription._id }, { $set: { reviewedAt: new Date(), reviewedBy: req.user._id, adminNote: clean(req.body.adminNote), creatorMessage } }),
    Notification.create({ user: subscription.creator, type: "verified_creator_approved", title: "You are now a Verified Creator", message: creatorMessage, severity: "info", priority: 60 }),
  ]);
  return sendResponse(res, 200, "Verified Creator approved and paid with Stars", { ...result, subscription: view(await VerifiedCreatorSubscription.findById(subscription._id)) });
});
export const rejectVerifiedCreator = asyncHandler((req, res) => decide(req, res, "REJECTED"));
