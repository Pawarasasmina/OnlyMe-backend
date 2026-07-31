import mongoose from "mongoose";
import CreatorProfile from "../models/CreatorProfile.js";
import DAWindow from "../models/DAWindow.js";
import Message from "../models/Message.js";
import Wallet from "../models/Wallet.js";
import PremiumMembership from "../models/PremiumMembership.js";
import Notification from "../models/Notification.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { activeDirectAccessWindow, openDirectAccessWindow, serializeDAWindow } from "../services/directAccessService.js";

const validId = (value) => {
  if (!mongoose.isValidObjectId(value)) throw new ApiError(400, "Invalid account id");
};

export const getDirectAccessOffer = asyncHandler(async (req, res) => {
  validId(req.params.creatorId);
  const profile = await CreatorProfile.findOne({ user: req.params.creatorId }).select("directAccessEnabled directAccessPriceStars").lean();
  if (!profile) throw new ApiError(404, "Creator profile not found");
  const active = req.user.role === "fan" ? await activeDirectAccessWindow(req.user._id, req.params.creatorId) : null;
  const [wallet, membership] = req.user.role === "fan" ? await Promise.all([
    Wallet.findOne({ user: req.user._id }).select("balance").lean(),
    PremiumMembership.findOne({ user: req.user._id, creator: req.params.creatorId, status: { $in: ["ACTIVE", "CANCEL_AT_PERIOD_END"] }, currentPeriodEnd: { $gt: new Date() } }).select("currentPeriodStart currentPeriodEnd directAccessAllowancePeriodStart directAccessAllowanceUsedAt").lean(),
  ]) : [null, null];
  const allowanceAvailable = Boolean(membership && (
    !membership.directAccessAllowanceUsedAt
    || String(membership.directAccessAllowancePeriodStart) !== String(membership.currentPeriodStart)
  ));
  return sendResponse(res, 200, "Direct Access offer fetched", {
    enabled: Boolean(profile.directAccessEnabled),
    priceStars: profile.directAccessPriceStars || 100,
    durationHours: 48,
    fanMessageLimit: 3,
    activeWindow: serializeDAWindow(active),
    walletBalance: wallet?.balance ?? null,
    premiumAllowance: membership ? { available: allowanceAvailable, renewsAt: membership.currentPeriodEnd } : null,
  });
});

export const updateDirectAccessSettings = asyncHandler(async (req, res) => {
  if (req.user.role !== "creator") throw new ApiError(403, "Only creators can configure Direct Access");
  const priceStars = Number(req.body.priceStars);
  if (!Number.isSafeInteger(priceStars) || priceStars < 10 || priceStars > 10000) throw new ApiError(400, "Direct Access price must be between 10 and 10,000 Stars");
  const profile = await CreatorProfile.findOneAndUpdate(
    { user: req.user._id },
    { $set: { directAccessEnabled: req.body.enabled === true, directAccessPriceStars: priceStars } },
    { new: true },
  ).select("directAccessEnabled directAccessPriceStars");
  if (!profile) throw new ApiError(404, "Creator profile not found");
  return sendResponse(res, 200, "Direct Access settings updated", {
    enabled: profile.directAccessEnabled,
    priceStars: profile.directAccessPriceStars,
  });
});

export const openWindow = asyncHandler(async (req, res) => {
  validId(req.params.creatorId);
  const result = await openDirectAccessWindow({
    fan: req.user,
    creatorId: req.params.creatorId,
    key: req.body.idempotencyKey,
    source: req.body.source || "PAID",
    creatorQuestionMessageId: req.body.creatorQuestionMessageId || null,
  });
  req.app.get("io")?.to(`user:${req.params.creatorId}`).emit("direct-access:opened", result.window);
  return sendResponse(res, 201, "Direct Access window opened", result);
});

export const askDirectAccessQuestion = asyncHandler(async (req, res) => {
  if (req.user.role !== "creator") throw new ApiError(403, "Only creators can ask a Direct Access question");
  validId(req.params.fanId);
  const body = String(req.body.body || "").trim();
  if (!body || body.length > 1000) throw new ApiError(400, "Question must be between 1 and 1,000 characters");
  const previous = await DAWindow.findOne({
    fan: req.params.fanId,
    creator: req.user._id,
    status: { $in: ["CLOSED", "EXPIRED"] },
    settlementStatus: { $in: ["CAPTURED", "INCLUDED"] },
    firstCreatorReplyAt: { $ne: null },
  }).sort({ createdAt: -1 });
  if (!previous) throw new ApiError(409, "A previous Direct Access conversation is required");
  const existing = await Message.findOne({ sender: req.user._id, clientMessageId: req.body.clientMessageId });
  if (existing) return sendResponse(res, 200, "Question already sent", {
    message: {
      id: String(existing._id),
      senderId: String(existing.sender),
      recipientId: String(existing.recipient),
      body: existing.body,
      mediaType: "text",
      messageKind: "CREATOR_ASK",
      directAccessWindowId: existing.directAccessWindow ? String(existing.directAccessWindow) : null,
      createdAt: existing.createdAt,
    },
    previousWindowId: String(previous._id),
  });
  const message = await Message.create({ sender: req.user._id, recipient: req.params.fanId, clientMessageId: req.body.clientMessageId, body, mediaType: "text", messageKind: "CREATOR_ASK", messageChannel: "STANDARD", directAccessWindow: previous._id });
  const payload = { id: String(message._id), senderId: String(message.sender), recipientId: String(message.recipient), body: message.body, mediaType: "text", messageKind: "CREATOR_ASK", directAccessWindowId: String(previous._id), createdAt: message.createdAt };
  await Notification.create({
    user: req.params.fanId,
    type: "creator_asked_question",
    title: `${req.user.name || "A creator"} asks you`,
    dedupeKey: `creator-ask:${message._id}`,
  });
  req.app.get("io")?.to(`user:${req.params.fanId}`).emit("message:new", { message: payload, conversationStatus: "ACTIVE" });
  return sendResponse(res, 201, "Question sent", { message: payload, previousWindowId: String(previous._id) });
});

export const listDirectAccessWindows = asyncHandler(async (req, res) => {
  const filter = req.user.role === "creator" ? { creator: req.user._id } : { fan: req.user._id };
  if (req.query.status) filter.status = String(req.query.status).toUpperCase();
  const windows = await DAWindow.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(Number(req.query.limit) || 50, 1), 100))
    .populate("fan creator", "name username avatar")
    .lean();
  const windowIds = windows.map((item) => item._id);
  const fanMessages = await Message.find({
    directAccessWindow: { $in: windowIds },
    messageKind: "USER_MESSAGE",
  }).sort({ createdAt: 1 }).select("directAccessWindow sender body").lean();
  const firstFanMessageByWindow = new Map();
  windows.forEach((window) => {
    const first = fanMessages.find((message) => (
      String(message.directAccessWindow) === String(window._id)
      && String(message.sender) === String(window.fan?._id || window.fan)
    ));
    if (first) firstFanMessageByWindow.set(String(window._id), first.body);
  });
  return sendResponse(res, 200, "Direct Access windows fetched", {
    windows: windows.map((window) => ({
      ...serializeDAWindow(window),
      questionQuote: firstFanMessageByWindow.get(String(window._id)) || "",
    })),
  });
});
