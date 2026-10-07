import ChatGift from "../models/ChatGift.js";
import DreamGift from "../models/DreamGift.js";
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

export const getMyReceivedGifts = asyncHandler(async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 60));
  const [chatGifts, dreamGifts] = await Promise.all([
    ChatGift.find({ recipient: req.user._id }).sort({ createdAt: -1 }).limit(limit).populate("sender", "name username avatar").lean(),
    DreamGift.find({ creator: req.user._id }).sort({ createdAt: -1 }).limit(limit).populate("supporter", "name username avatar").lean(),
  ]);
  const gifts = [
    ...chatGifts.map((gift) => ({ id: `chat-${gift._id}`, name: gift.giftName, imageUrl: gift.giftImageUrl, stars: gift.starsAmount, source: gift.sourceType === "STORY" ? "Story" : "Direct", message: gift.messageText || "", visibility: gift.visibility || "EVERYONE", sender: sender(gift.sender), thankedAt: gift.thankedAt || null, createdAt: gift.createdAt })),
    ...dreamGifts.map((gift) => ({ id: `dream-${gift._id}`, name: gift.giftName, imageUrl: gift.giftImageUrl, stars: gift.starsAmount, source: "Dream", sender: sender(gift.supporter, gift.privateSupport), thankedAt: gift.thankedAt || null, createdAt: gift.createdAt })),
  ].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt)).slice(0, limit);
  return sendResponse(res, 200, "Received gifts fetched", { gifts, total: chatGifts.length + dreamGifts.length });
});

export const thankReceivedGift = asyncHandler(async (req, res) => {
  const [kind, giftId] = String(req.params.giftId || "").split("-");
  const config = kind === "chat"
    ? { model: ChatGift, ownerField: "recipient", senderField: "sender", privateFilter: {} }
    : kind === "dream"
      ? { model: DreamGift, ownerField: "creator", senderField: "supporter", privateFilter: { privateSupport: false } }
      : null;
  if (!config || !mongoose.isValidObjectId(giftId)) throw new ApiError(400, "Invalid gift id");

  const thankedAt = new Date();
  const gift = await config.model.findOneAndUpdate(
    { _id: giftId, [config.ownerField]: req.user._id, ...config.privateFilter },
    { $set: { thankedAt } },
    { new: true },
  ).lean();
  if (!gift) throw new ApiError(404, "Received gift not found");

  await Notification.updateOne(
    { dedupeKey: `gift-thanks:${kind}:${giftId}` },
    { $setOnInsert: { user: gift[config.senderField], type: "gift_thanks", title: `${req.user.name || req.user.username || "Someone"} thanked you for ${gift.giftName}`, dedupeKey: `gift-thanks:${kind}:${giftId}` } },
    { upsert: true },
  );
  return sendResponse(res, 200, "Gift sender thanked", { thankedAt: gift.thankedAt });
});

export const getPublicReceivedGifts = asyncHandler(async (req, res) => {
  const owner = await User.findOne({ username: String(req.params.username || "").toLowerCase(), status: "active" }).select("_id").lean();
  if (!owner) throw new ApiError(404, "Profile not found");
  const limit = Math.min(12, Math.max(1, Number(req.query.limit) || 12));
  const [chatGifts, dreamGifts] = await Promise.all([
    ChatGift.find({ recipient: owner._id, visibility: "EVERYONE" }).sort({ createdAt: -1 }).limit(limit).lean(),
    DreamGift.find({ creator: owner._id, privateSupport: false }).sort({ createdAt: -1 }).limit(limit).lean(),
  ]);
  const gifts = [
    ...chatGifts.map((gift) => ({ id: `chat-${gift._id}`, name: gift.giftName, imageUrl: gift.giftImageUrl, stars: gift.starsAmount, source: gift.sourceType === "STORY" ? "Story" : "Direct", createdAt: gift.createdAt })),
    ...dreamGifts.map((gift) => ({ id: `dream-${gift._id}`, name: gift.giftName, imageUrl: gift.giftImageUrl, stars: gift.starsAmount, source: "Dream", createdAt: gift.createdAt })),
  ].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt)).slice(0, limit);
  return sendResponse(res, 200, "Public gifts fetched", { gifts, total: chatGifts.length + dreamGifts.length });
});
