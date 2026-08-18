import mongoose from "mongoose";
import CreatorProfile from "../models/CreatorProfile.js";
import DAWindow from "../models/DAWindow.js";
import Message from "../models/Message.js";
import Wallet from "../models/Wallet.js";
import PremiumMembership from "../models/PremiumMembership.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { hasCreatorAccess, isConsumerAccount } from "../utils/accountCapabilities.js";
import { activeDirectAccessWindow, createDirectAccessMessageAtomic, creatorTypicalReplyHours, openDirectAccessWindow, processDueDirectAccessWindows, refundDirectAccessWindow, serializeDAWindow } from "../services/directAccessService.js";

const validId = (value) => {
  if (!mongoose.isValidObjectId(value)) throw new ApiError(400, "Invalid account id");
};

export const getDirectAccessOffer = asyncHandler(async (req, res) => {
  validId(req.params.creatorId);
  const profile = await CreatorProfile.findOne({ user: req.params.creatorId }).select("directAccessEnabled directAccessPriceStars directCallEnabled directCallPriceStars directCallDurationMinutes directCallAutoDeclineAway").lean();
  if (!profile) throw new ApiError(404, "Creator profile not found");
  const active = isConsumerAccount(req.user) ? await activeDirectAccessWindow(req.user._id, req.params.creatorId) : null;
  const [wallet, membership] = isConsumerAccount(req.user) ? await Promise.all([
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
    callEnabled: Boolean(profile.directCallEnabled),
    callPriceStars: profile.directCallPriceStars || 500,
    callDurationMinutes: profile.directCallDurationMinutes || 5,
    callAutoDeclineAway: Boolean(profile.directCallAutoDeclineAway),
    durationHours: 48,
    fanMessageLimit: 3,
    activeWindow: serializeDAWindow(active),
    typicalReplyHours: await creatorTypicalReplyHours(req.params.creatorId),
    walletBalance: wallet?.balance ?? null,
    premiumAllowance: membership ? { available: allowanceAvailable, renewsAt: membership.currentPeriodEnd } : null,
  });
});

export const updateDirectAccessSettings = asyncHandler(async (req, res) => {
  if (!hasCreatorAccess(req.user)) throw new ApiError(403, "Only approved creators can configure Direct Access");
  const priceStars = Number(req.body.priceStars);
  if (!Number.isSafeInteger(priceStars) || priceStars < 10 || priceStars > 10000) throw new ApiError(400, "Direct Access price must be between 10 and 10,000 Stars");
  const callPriceStars = Number(req.body.callPriceStars ?? 500);
  const callDurationMinutes = Number(req.body.callDurationMinutes ?? 5);
  if (![100, 300, 500, 800, 1500].includes(callPriceStars)) throw new ApiError(400, "Choose a supported call price");
  if (![2, 5, 10, 15, 20, 30].includes(callDurationMinutes)) throw new ApiError(400, "Choose a supported call duration");
  const profile = await CreatorProfile.findOneAndUpdate(
    { user: req.user._id },
    { $set: { directAccessEnabled: req.body.enabled === true, directAccessPriceStars: priceStars, directCallEnabled: req.body.callEnabled === true, directCallPriceStars: callPriceStars, directCallDurationMinutes: callDurationMinutes, directCallAutoDeclineAway: req.body.callAutoDeclineAway === true } },
    { new: true },
  ).select("directAccessEnabled directAccessPriceStars directCallEnabled directCallPriceStars directCallDurationMinutes directCallAutoDeclineAway");
  if (!profile) throw new ApiError(404, "Creator profile not found");
  return sendResponse(res, 200, "Direct Access settings updated", {
    enabled: profile.directAccessEnabled,
    priceStars: profile.directAccessPriceStars,
    callEnabled: profile.directCallEnabled,
    callPriceStars: profile.directCallPriceStars,
    callDurationMinutes: profile.directCallDurationMinutes,
    callAutoDeclineAway: profile.directCallAutoDeclineAway,
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
  const platformRateBasisPoints = result.window?.source === "CREATOR_REOPEN" ? 2000 : 1000;
  const priceStars = Number(result.window?.priceStars || 0);
  req.app.get("io")?.to(`user:${req.params.creatorId}`).emit("direct-access:opened", {
    ...result.window,
    creatorEarningStars: Math.max(0, priceStars - Math.floor((priceStars * platformRateBasisPoints) / 10000)),
    creatorNetUsd: Number(((Math.max(0, priceStars - Math.floor((priceStars * platformRateBasisPoints) / 10000)) * 10) / 100).toFixed(2)),
    fan: { id: String(req.user._id), displayName: req.user.name, username: req.user.username, avatarUrl: req.user.avatar || null },
  });
  return sendResponse(res, 201, "Direct Access window opened", result);
});

export const askDirectAccessQuestion = asyncHandler(async (req, res) => {
  if (!hasCreatorAccess(req.user)) throw new ApiError(403, "Only approved creators can ask a Direct Access question");
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

export const sendFreeFanFollowup = asyncHandler(async (req, res) => {
  if (!isConsumerAccount(req.user)) throw new ApiError(403, "This account cannot send a follow-up");
  validId(req.params.creatorId);
  const body = String(req.body.body || "").trim();
  const clientMessageId = String(req.body.clientMessageId || "").trim();
  if (!body || body.length > 1000) throw new ApiError(400, "Question must be between 1 and 1,000 characters");
  await processDueDirectAccessWindows(new Date(), req.app.get("io"));
  const existing = clientMessageId ? await Message.findOne({ sender: req.user._id, clientMessageId }) : null;
  if (existing) {
    const previousWindow = await DAWindow.findById(existing.directAccessWindow);
    return sendResponse(res, 200, "Follow-up already sent", { message: { id: String(existing._id), senderId: String(existing.sender), recipientId: String(existing.recipient), body: existing.body, mediaType: "text", messageKind: existing.messageKind, directAccessWindowId: String(existing.directAccessWindow), createdAt: existing.createdAt }, directAccessWindow: serializeDAWindow(previousWindow) });
  }
  if (await activeDirectAccessWindow(req.user._id, req.params.creatorId)) throw new ApiError(409, "A Direct Access window is already open");
  const previous = await DAWindow.findOne({ fan: req.user._id, creator: req.params.creatorId, status: { $in: ["CLOSED", "EXPIRED", "ANSWERED"] }, settlementStatus: { $in: ["CAPTURED", "INCLUDED", "REFUNDED"] } }).sort({ createdAt: -1 });
  if (!previous) throw new ApiError(409, "An ended Direct Access window is required");
  const unresolved = await Message.findOne({ sender: req.user._id, recipient: req.params.creatorId, messageKind: "FAN_FREE_ASK", directAccessWindow: previous._id }).sort({ createdAt: -1 });
  if (unresolved) {
    const opened = await DAWindow.exists({ creatorQuestionMessage: unresolved._id, source: "FAN_FOLLOWUP" });
    if (!opened) throw new ApiError(409, "Wait for the creator to answer your previous follow-up");
  }
  const profile = await CreatorProfile.findOne({ user: req.params.creatorId }).select("directAccessEnabled directAccessPriceStars").lean();
  if (!profile?.directAccessEnabled) throw new ApiError(403, "This creator is not accepting Direct Access");
  const wallet = await Wallet.findOne({ user: req.user._id }).select("balance").lean();
  const priceStars = Number(profile.directAccessPriceStars || 100);
  if (Number(wallet?.balance || 0) < priceStars) throw new ApiError(422, "Insufficient Stars", "INSUFFICIENT_STARS");
  const message = await Message.create({ sender: req.user._id, recipient: req.params.creatorId, clientMessageId, body, mediaType: "text", messageKind: "FAN_FREE_ASK", messageChannel: "DIRECT_ACCESS", directAccessWindow: previous._id });
  const payload = { id: String(message._id), senderId: String(message.sender), recipientId: String(message.recipient), body: message.body, mediaType: "text", messageKind: "FAN_FREE_ASK", directAccessWindowId: String(previous._id), createdAt: message.createdAt };
  req.app.get("io")?.to(`user:${req.params.creatorId}`).emit("message:new", { message: payload, conversationStatus: "ACTIVE" });
  return sendResponse(res, 201, "Free follow-up sent", { message: payload, directAccessWindow: serializeDAWindow(previous), chargePending: { priceStars } });
});

export const replyToFreeFanFollowup = asyncHandler(async (req, res) => {
  if (!hasCreatorAccess(req.user)) throw new ApiError(403, "Only approved creators can answer this follow-up");
  validId(req.params.messageId);
  const body = String(req.body.body || "").trim();
  const clientMessageId = String(req.body.clientMessageId || "").trim();
  if (!body || body.length > 2000) throw new ApiError(400, "Reply must be between 1 and 2,000 characters");
  const existing = clientMessageId ? await Message.findOne({ sender: req.user._id, clientMessageId }) : null;
  if (existing) return sendResponse(res, 200, "Reply already sent", { message: { id: String(existing._id), senderId: String(existing.sender), recipientId: String(existing.recipient), body: existing.body, mediaType: existing.mediaType, messageKind: existing.messageKind, directAccessWindowId: String(existing.directAccessWindow), createdAt: existing.createdAt }, directAccessWindow: serializeDAWindow(await DAWindow.findById(existing.directAccessWindow)) });
  const followup = await Message.findOne({ _id: req.params.messageId, recipient: req.user._id, messageKind: "FAN_FREE_ASK" });
  if (!followup) throw new ApiError(404, "Fan follow-up not found");
  const fan = await User.findOne({ _id: followup.sender, role: { $in: ["fan", "creator"] }, status: "active" });
  if (!fan) throw new ApiError(404, "Fan not found");
  let window = await DAWindow.findOne({ creatorQuestionMessage: followup._id, source: "FAN_FOLLOWUP" });
  let openedNow = false;
  if (!window) {
    const opened = await openDirectAccessWindow({ fan, creatorId: req.user._id, key: req.body.idempotencyKey, source: "FAN_FOLLOWUP", fanFollowupMessageId: followup._id });
    window = await DAWindow.findById(opened.window.id);
    openedNow = true;
  }
  let committed;
  try {
    committed = await createDirectAccessMessageAtomic({ windowId: window._id, sender: req.user, recipient: fan, message: { clientMessageId, body, mediaType: "text" } });
  } catch (error) {
    if (openedNow) await refundDirectAccessWindow(window._id).catch(() => {});
    throw error;
  }
  const payload = { id: String(committed.message._id), clientMessageId, senderId: String(req.user._id), recipientId: String(fan._id), body, mediaType: "text", messageKind: "USER_MESSAGE", directAccessWindowId: String(window._id), createdAt: committed.message.createdAt };
  req.app.get("io")?.to(`user:${fan._id}`).emit("message:new", { message: payload, conversationStatus: "ACTIVE" });
  req.app.get("io")?.to(`user:${fan._id}`).to(`user:${req.user._id}`).emit("direct-access:updated", serializeDAWindow(committed.window));
  return sendResponse(res, committed.replay ? 200 : 201, "Paid reply sent", { message: payload, directAccessWindow: serializeDAWindow(committed.window) });
});

export const listDirectAccessWindows = asyncHandler(async (req, res) => {
  const filter = { $or: [{ creator: req.user._id }, { fan: req.user._id }] };
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
