import ChatGift from "../models/ChatGift.js";
import DreamGift from "../models/DreamGift.js";
import User from "../models/User.js";
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
    ...chatGifts.map((gift) => ({ id: `chat-${gift._id}`, name: gift.giftName, imageUrl: gift.giftImageUrl, stars: gift.starsAmount, source: gift.sourceType === "STORY" ? "Story" : "Direct", message: gift.messageText || "", visibility: gift.visibility || "EVERYONE", sender: sender(gift.sender), createdAt: gift.createdAt })),
    ...dreamGifts.map((gift) => ({ id: `dream-${gift._id}`, name: gift.giftName, imageUrl: gift.giftImageUrl, stars: gift.starsAmount, source: "Dream", sender: sender(gift.supporter, gift.privateSupport), createdAt: gift.createdAt })),
  ].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt)).slice(0, limit);
  return sendResponse(res, 200, "Received gifts fetched", { gifts, total: chatGifts.length + dreamGifts.length });
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
