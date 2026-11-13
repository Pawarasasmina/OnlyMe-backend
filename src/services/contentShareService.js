import mongoose from "mongoose";
import ContentShareEvent, { SHARE_ROUTES } from "../models/ContentShareEvent.js";
import FeedPost from "../models/FeedPost.js";
import Publication from "../models/Publication.js";
import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";

export async function resolveShareTarget(contentType, contentId) {
  if (!["feed_post", "seen"].includes(contentType) || !mongoose.isValidObjectId(contentId)) throw new ApiError(400, "Invalid share target");
  if (contentType === "feed_post") {
    const item = await FeedPost.findOne({ _id: contentId, status: "published", visibility: "public", deletedAt: null }).select("author privateShareCount").lean();
    if (!item) throw new ApiError(404, "Wall note not found");
    return { owner: item.author, model: FeedPost, item };
  }
  const item = await Publication.findOne({ _id: contentId, kind: "SEEN", status: { $in: ["PUBLISHED", "CHANGES_REQUESTED"] } }).select("creator privateShareCount").lean();
  if (!item) throw new ApiError(404, "Seen not found");
  return { owner: item.creator, model: Publication, item };
}

export async function recordPrivateShare({ user, contentType, contentId, route }) {
  const normalizedRoute = String(route || "").toUpperCase();
  if (!SHARE_ROUTES.includes(normalizedRoute)) throw new ApiError(400, "Invalid share route");
  const target = await resolveShareTarget(contentType, contentId);
  if (String(target.owner) === String(user._id)) return { counted: false, privateShareCount: Number(target.item.privateShareCount || 0) };
  const actor = await User.findById(user._id).select("status shareCountingRestrictedAt shareCountingRestrictionReason postingRestrictionReason messagingRestrictionReason").lean();
  const spamRestricted = actor?.shareCountingRestrictedAt || /spam/i.test([actor?.shareCountingRestrictionReason, actor?.postingRestrictionReason, actor?.messagingRestrictionReason].filter(Boolean).join(" "));
  if (!actor || actor.status !== "active" || spamRestricted) return { counted: false, privateShareCount: Number(target.item.privateShareCount || 0) };
  let created = false;
  try {
    await ContentShareEvent.create({ user: user._id, owner: target.owner, contentType, contentId, firstRoute: normalizedRoute, routes: [normalizedRoute], lastSharedAt: new Date() });
    created = true;
  } catch (error) {
    if (error?.code !== 11000) throw error;
    await ContentShareEvent.updateOne({ user: user._id, contentType, contentId }, { $addToSet: { routes: normalizedRoute }, $set: { lastSharedAt: new Date() } });
  }
  const privateShareCount = await ContentShareEvent.countDocuments({ contentType, contentId });
  await target.model.updateOne({ _id: contentId }, { $set: { privateShareCount } });
  return { counted: created, privateShareCount };
}

export async function weeklySeenShareSummary(owner, since = new Date(Date.now() - 7 * 86400000)) {
  return ContentShareEvent.aggregate([
    { $match: { owner: new mongoose.Types.ObjectId(owner), contentType: "seen", createdAt: { $gte: since } } },
    { $group: { _id: "$contentId", shares: { $sum: 1 } } },
    { $sort: { shares: -1 } },
  ]);
}
