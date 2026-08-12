import mongoose from "mongoose";
import Dream from "../models/Dream.js";
import DreamGift from "../models/DreamGift.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";
import { executeFinancialCommand } from "./financialCommandService.js";
import { transferStars, safeWallet } from "./walletLedgerService.js";
import { fingerprint, idempotencyKey } from "../validators/financialValidator.js";

export const DREAM_GIFTS = [
  ["rain", "Caught Feelings", 30], ["iloveyou", "I Love You", 50], ["selfie", "Main Character", 90],
  ["glow", "Glow Up", 150], ["shopping", "Retail Therapy", 190], ["fit", "Fit Check", 290],
  ["ufo", "Beam Me Up", 390], ["pop", "Pop Off", 500], ["rocket", "To The Moon", 1000],
  ["gold", "Struck Gold", 1500], ["bath", "Money Bath", 2000], ["summit", "Summit", 2500],
  ["bugatti", "Night Rider", 3500], ["lambo", "Full Send", 5000], ["throne", "Her Majesty", 7500],
  ["crown", "The Crown", 10000],
].map(([key, name, stars]) => ({ key, name, stars }));

const clean = (value, max) => String(value || "").trim().slice(0, max);
const serialize = (dream, supporters = []) => dream ? ({ id: dream._id, emoji: dream.emoji, title: dream.title, reason: dream.reason, goalStars: dream.goalStars, receivedStars: dream.receivedStars, supporterCount: dream.supporterCount, status: dream.status, completedAt: dream.completedAt, version: dream.version, creator: dream.creator?._id ? { id: dream.creator._id, name: dream.creator.name, username: dream.creator.username, avatar: dream.creator.avatar } : undefined, supporters }) : null;

export async function publicDream(username) {
  const creator = await User.findOne({ username: String(username).toLowerCase(), role: "creator", status: "active" }).select("name username avatar").lean();
  if (!creator) throw new ApiError(404, "Creator not found");
  const dream = await Dream.findOne({ creator: creator._id, status: { $in: ["ACTIVE", "COMPLETED"] } }).sort({ status: 1, updatedAt: -1 }).populate("creator", "name username avatar").lean();
  if (!dream) return null;
  const gifts = await DreamGift.find({ dream: dream._id, privateSupport: false }).sort({ createdAt: -1 }).limit(8).populate("supporter", "name username avatar").lean();
  const supporters = gifts.filter((gift) => gift.supporter).map((gift) => ({ name: gift.supporter.name, username: gift.supporter.username, avatar: gift.supporter.avatar, giftName: gift.giftName }));
  return serialize(dream, supporters);
}

export async function saveDream(creatorId, payload) {
  const title = clean(payload.title, 40), reason = clean(payload.reason, 120), emoji = clean(payload.emoji, 16) || "✨";
  const goalStars = Number(payload.goalStars);
  if (!title || !reason) throw new ApiError(400, "Dream title and why it matters are required");
  if (![500, 900, 1500, 2500, 5000].includes(goalStars)) throw new ApiError(400, "Choose a supported Dream goal");
  const existing = await Dream.findOne({ creator: creatorId, status: "ACTIVE" });
  if (existing) {
    const version = Number(payload.version);
    const updated = await Dream.findOneAndUpdate({ _id: existing._id, creator: creatorId, status: "ACTIVE", version }, { $set: { title, reason, emoji, goalStars }, $inc: { version: 1 } }, { new: true, runValidators: true });
    if (!updated) throw new ApiError(409, "Dream changed while editing");
    return serialize(updated);
  }
  return serialize(await Dream.create({ creator: creatorId, title, reason, emoji, goalStars }));
}

export async function changeDreamStatus(creatorId, id, status, version) {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(400, "Invalid Dream ID");
  const set = status === "COMPLETED" ? { status, completedAt: new Date() } : { status: "REMOVED", removedAt: new Date() };
  const dream = await Dream.findOneAndUpdate({ _id: id, creator: creatorId, status: "ACTIVE", version: Number(version) }, { $set: set, $inc: { version: 1 } }, { new: true });
  if (!dream) throw new ApiError(409, "Active Dream not found or changed");
  return serialize(dream);
}

export async function sendDreamGift({ user, dreamId, giftKey, privateSupport, key }) {
  key = idempotencyKey(key);
  const gift = DREAM_GIFTS.find((item) => item.key === giftKey);
  if (!gift) throw new ApiError(400, "Choose a supported Dream gift");
  return executeFinancialCommand({ user: user._id, commandType: "SEND_DREAM_GIFT", idempotencyKey: key, requestFingerprint: fingerprint({ dreamId: String(dreamId), giftKey, privateSupport: Boolean(privateSupport) }) }, async (session, command) => {
    const dream = await Dream.findOne({ _id: dreamId, status: "ACTIVE" }).session(session);
    if (!dream) throw new ApiError(409, "This Dream is not accepting support");
    if (String(dream.creator) === String(user._id)) throw new ApiError(409, "You cannot send a gift to your own Dream");
    const wasSupporter = await DreamGift.exists({ dream: dream._id, supporter: user._id }).session(session);
    const moved = await transferStars({ fromUser: user._id, toUser: dream.creator, amount: gift.stars, debitType: "DREAM_GIFT_DEBIT", creditType: "DREAM_CREATOR_EARNING", referenceType: "DREAM_GIFT", referenceId: dream._id, creator: dream.creator, command, idempotencyKey: key, metadata: { dreamId: String(dream._id), giftKey: gift.key, giftName: gift.name } }, session);
    const [record] = await DreamGift.create([{ dream: dream._id, supporter: user._id, creator: dream.creator, giftKey: gift.key, giftName: gift.name, starsAmount: gift.stars, privateSupport: Boolean(privateSupport), debitLedgerEntry: moved.debit.entry._id, creditLedgerEntry: moved.credit.entry._id, idempotencyKey: key }], { session });
    const updated = await Dream.findOneAndUpdate({ _id: dream._id, status: "ACTIVE" }, { $inc: { receivedStars: gift.stars, supporterCount: wasSupporter ? 0 : 1, version: 1 } }, { new: true, session });
    await Notification.create([{ user: dream.creator, type: "dream_gift", title: `${privateSupport ? "Someone" : user.name} sent ${gift.name} (✦${gift.stars}) toward your Dream`, dedupeKey: `dream-gift:${record._id}` }], { session });
    return { resultReference: record._id, gift: { id: record._id, name: gift.name, stars: gift.stars }, dream: serialize(updated), wallet: safeWallet(moved.debit.wallet) };
  });
}
