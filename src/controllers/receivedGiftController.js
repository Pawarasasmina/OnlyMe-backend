import ChatGift from "../models/ChatGift.js";
import DreamGift from "../models/DreamGift.js";
import MessageReport from "../models/MessageReport.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import mongoose from "mongoose";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

const sender = (user, hidden = false) => hidden ? { name: "Private supporter", username: "", avatar: "" } : {
  id: user?._id ? String(user._id) : null,
  name: user?.name || user?.username || "Someone",
  username: user?.username || "",
  avatar: user?.avatar || "",
};

const REPORT_REASONS = new Set(["SPAM", "FALSE_INFORMATION", "HARASSMENT", "HATE", "NUDITY", "SEXUAL_CONTENT", "VIOLENCE", "ILLEGAL_CONTENT", "COPYRIGHT", "SCAM", "OTHER"]);

function receivedGiftConfig(value) {
  const [kind, giftId] = String(value || "").split("-");
  if (!mongoose.isValidObjectId(giftId)) throw new ApiError(400, "Invalid gift id");
  if (kind === "chat") return { kind, giftId, model: ChatGift, ownerField: "recipient", senderField: "sender", privateFilter: {}, reportField: "chatGift" };
  if (kind === "dream") return { kind, giftId, model: DreamGift, ownerField: "creator", senderField: "supporter", privateFilter: { privateSupport: false }, reportField: "dreamGift" };
  throw new ApiError(400, "Invalid gift id");
}

function serializeGift(gift, kind, senderUser, hiddenSender = false) {
  return {
    id: `${kind}-${gift._id}`,
    name: gift.giftName,
    imageUrl: gift.giftImageUrl,
    stars: gift.starsAmount,
    source: kind === "chat" ? (gift.sourceType === "STORY" ? "Story" : "Direct") : "Dream",
    message: gift.messageText || "",
    visibility: kind === "chat" ? (gift.visibility || "EVERYONE") : (gift.privateSupport ? "RECIPIENT_ONLY" : "EVERYONE"),
    hiddenFromProfile: Boolean(gift.hiddenFromProfile),
    featuredOnProfile: Boolean(gift.featuredOnProfile),
    sender: sender(senderUser, hiddenSender),
    thankedAt: gift.thankedAt || null,
    createdAt: gift.createdAt,
  };
}

export const getMyReceivedGifts = asyncHandler(async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 60));
  const [chatGifts, dreamGifts] = await Promise.all([
    ChatGift.find({ recipient: req.user._id }).sort({ createdAt: -1 }).limit(limit).populate("sender", "name username avatar").lean(),
    DreamGift.find({ creator: req.user._id }).sort({ createdAt: -1 }).limit(limit).populate("supporter", "name username avatar").lean(),
  ]);
  const gifts = [
    ...chatGifts.map((gift) => serializeGift(gift, "chat", gift.sender)),
    ...dreamGifts.map((gift) => serializeGift(gift, "dream", gift.supporter, gift.privateSupport)),
  ].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt)).slice(0, limit);
  return sendResponse(res, 200, "Received gifts fetched", { gifts, total: chatGifts.length + dreamGifts.length });
});

export const thankReceivedGift = asyncHandler(async (req, res) => {
  const config = receivedGiftConfig(req.params.giftId);

  const thankedAt = new Date();
  const gift = await config.model.findOneAndUpdate(
    { _id: config.giftId, [config.ownerField]: req.user._id, ...config.privateFilter },
    { $set: { thankedAt } },
    { new: true },
  ).lean();
  if (!gift) throw new ApiError(404, "Received gift not found");

  await Notification.updateOne(
    { dedupeKey: `gift-thanks:${config.kind}:${config.giftId}` },
    { $setOnInsert: { user: gift[config.senderField], type: "gift_thanks", title: `${req.user.name || req.user.username || "Someone"} thanked you for ${gift.giftName}`, dedupeKey: `gift-thanks:${config.kind}:${config.giftId}` } },
    { upsert: true },
  );
  return sendResponse(res, 200, "Gift sender thanked", { thankedAt: gift.thankedAt });
});

export const updateReceivedGiftProfileState = asyncHandler(async (req, res) => {
  const config = receivedGiftConfig(req.params.giftId);
  const set = {};
  if (Object.hasOwn(req.body, "featuredOnProfile")) set.featuredOnProfile = Boolean(req.body.featuredOnProfile);
  if (Object.hasOwn(req.body, "hiddenFromProfile")) set.hiddenFromProfile = Boolean(req.body.hiddenFromProfile);
  if (!Object.keys(set).length) throw new ApiError(400, "Choose a gift profile setting to update");
  const gift = await config.model.findOneAndUpdate(
    { _id: config.giftId, [config.ownerField]: req.user._id },
    { $set: set },
    { new: true, runValidators: true },
  ).populate(config.senderField, "name username avatar").lean();
  if (!gift) throw new ApiError(404, "Received gift not found");
  return sendResponse(res, 200, "Gift profile setting updated", { gift: serializeGift(gift, config.kind, gift[config.senderField], config.kind === "dream" && gift.privateSupport) });
});

export const reportReceivedGift = asyncHandler(async (req, res) => {
  const config = receivedGiftConfig(req.params.giftId);
  const gift = await config.model.findOne({ _id: config.giftId, [config.ownerField]: req.user._id }).populate(config.senderField, "name username avatar role").lean();
  if (!gift) throw new ApiError(404, "Received gift not found");
  const reportedUser = gift[config.senderField]?._id || gift[config.senderField];
  if (!reportedUser) throw new ApiError(409, "This gift cannot be reported");
  const reason = String(req.body.reason || "").trim().toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_");
  if (!REPORT_REASONS.has(reason)) throw new ApiError(400, "Select a valid report reason");
  const details = String(req.body.details || "").trim().slice(0, 1000);
  try {
    const report = await MessageReport.create({
      reporter: req.user._id,
      reportedUser,
      scope: "GIFT",
      [config.reportField]: gift._id,
      reason,
      details,
      snapshot: {
        giftId: `${config.kind}-${gift._id}`,
        giftKind: config.kind,
        giftName: gift.giftName,
        giftImageUrl: gift.giftImageUrl,
        starsAmount: gift.starsAmount,
        messageText: gift.messageText || "",
        visibility: config.kind === "chat" ? gift.visibility : (gift.privateSupport ? "RECIPIENT_ONLY" : "EVERYONE"),
        sender: gift[config.senderField] ? { id: String(gift[config.senderField]._id || gift[config.senderField]), username: gift[config.senderField].username || "", name: gift[config.senderField].name || "" } : null,
        recipient: String(req.user._id),
        createdAt: gift.createdAt,
      },
    });
    return sendResponse(res, 201, "Gift report received", { reportId: String(report._id), status: report.status });
  } catch (error) {
    if (error?.code === 11000) throw new ApiError(409, "You already reported this gift");
    throw error;
  }
});

export const getPublicReceivedGifts = asyncHandler(async (req, res) => {
  const owner = await User.findOne({ username: String(req.params.username || "").toLowerCase(), status: "active" }).select("_id").lean();
  if (!owner) throw new ApiError(404, "Profile not found");
  const limit = Math.min(12, Math.max(1, Number(req.query.limit) || 12));
  const [chatGifts, dreamGifts] = await Promise.all([
    ChatGift.find({ recipient: owner._id, visibility: "EVERYONE", hiddenFromProfile: { $ne: true } }).sort({ featuredOnProfile: -1, createdAt: -1 }).limit(limit).lean(),
    DreamGift.find({ creator: owner._id, privateSupport: false, hiddenFromProfile: { $ne: true } }).sort({ featuredOnProfile: -1, createdAt: -1 }).limit(limit).lean(),
  ]);
  const gifts = [
    ...chatGifts.map((gift) => serializeGift(gift, "chat")),
    ...dreamGifts.map((gift) => serializeGift(gift, "dream")),
  ].sort((left, right) => Number(right.featuredOnProfile) - Number(left.featuredOnProfile) || new Date(right.createdAt) - new Date(left.createdAt)).slice(0, limit);
  return sendResponse(res, 200, "Public gifts fetched", { gifts, total: chatGifts.length + dreamGifts.length });
});
