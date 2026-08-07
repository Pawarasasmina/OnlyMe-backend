import mongoose from "mongoose";
import Publication from "../models/Publication.js";
import SeenEngagement from "../models/SeenEngagement.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

const publishedSeen = async (id) => {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(400, "Invalid Seen ID");
  const publication = await Publication.findOne({ _id: id, kind: "SEEN", status: "PUBLISHED" }).select("_id creator").lean();
  if (!publication) throw new ApiError(404, "Published Seen not found");
  return publication;
};

const publishedPlanet = async (id) => {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(400, "Invalid Planet ID");
  const publication = await Publication.findOne({ _id: id, kind: { $in: ["WORLD", "PREMIUM_WORLD"] }, status: "PUBLISHED" }).select("_id creator title").lean();
  if (!publication) throw new ApiError(404, "Published Planet not found");
  return publication;
};

const publishedCommentable = async (id) => {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(400, "Invalid publication ID");
  const publication = await Publication.findOne({ _id: id, kind: { $in: ["SEEN", "WORLD", "PREMIUM_WORLD"] }, status: "PUBLISHED" }).select("_id creator").lean();
  if (!publication) throw new ApiError(404, "Published content not found");
  return publication;
};

const summary = async (publication, viewerId) => {
  const [counts, viewer, comments] = await Promise.all([
    SeenEngagement.aggregate([{ $match: { publication: new mongoose.Types.ObjectId(publication) } }, { $group: { _id: "$type", count: { $sum: 1 } } }]),
    viewerId ? SeenEngagement.find({ publication, user: viewerId, type: { $in: ["REACTION", "SHARE", "SAVE"] } }).lean() : [],
    SeenEngagement.find({ publication, type: "COMMENT" }).sort({ createdAt: -1 }).limit(50).populate("user", "name username avatar").lean(),
  ]);
  const count = Object.fromEntries(counts.map((item) => [item._id, item.count]));
  return { reactionCount: count.REACTION || 0, commentCount: count.COMMENT || 0, shareCount: count.SHARE || 0, saveCount: count.SAVE || 0, viewerReaction: viewer.find((item) => item.type === "REACTION")?.reaction || null, viewerShared: Boolean(viewer.find((item) => item.type === "SHARE")), viewerSaved: Boolean(viewer.find((item) => item.type === "SAVE")), comments: comments.reverse().map((item) => ({ id: item._id, text: item.text, createdAt: item.createdAt, author: { id: item.user?._id, name: item.user?.name, username: item.user?.username, avatar: item.user?.avatar || "" } })) };
};

export const getSeenEngagement = asyncHandler(async (req, res) => { await publishedCommentable(req.params.id); return sendResponse(res, 200, "Publication engagement fetched", { engagement: await summary(req.params.id, req.user?._id) }); });

export const reactToSeen = asyncHandler(async (req, res) => {
  await publishedSeen(req.params.id); const reaction = String(req.body.reaction || "").toUpperCase();
  if (!["LIKE", "LOVE", "INSIGHTFUL"].includes(reaction)) throw new ApiError(400, "A valid reaction is required");
  await SeenEngagement.findOneAndUpdate({ publication: req.params.id, user: req.user._id, type: "REACTION" }, { $set: { reaction } }, { upsert: true, new: true, runValidators: true });
  return sendResponse(res, 200, "Reaction saved", { engagement: await summary(req.params.id, req.user._id) });
});

export const removeSeenReaction = asyncHandler(async (req, res) => { await publishedSeen(req.params.id); await SeenEngagement.deleteOne({ publication: req.params.id, user: req.user._id, type: "REACTION" }); return sendResponse(res, 200, "Reaction removed", { engagement: await summary(req.params.id, req.user._id) }); });

export const commentOnSeen = asyncHandler(async (req, res) => {
  await publishedCommentable(req.params.id); const text = String(req.body.text || "").trim();
  if (!text || text.length > 500) throw new ApiError(400, "Comment must contain 1 to 500 characters");
  await SeenEngagement.create({ publication: req.params.id, user: req.user._id, type: "COMMENT", text });
  return sendResponse(res, 201, "Comment added", { engagement: await summary(req.params.id, req.user._id) });
});

export const shareSeen = asyncHandler(async (req, res) => { await publishedSeen(req.params.id); const caption = String(req.body.caption || "").trim(); if (caption.length > 500) throw new ApiError(400, "Share caption must not exceed 500 characters"); await SeenEngagement.findOneAndUpdate({ publication: req.params.id, user: req.user._id, type: "SHARE" }, { $set: { text: caption || undefined }, $setOnInsert: { publication: req.params.id, user: req.user._id, type: "SHARE" } }, { upsert: true, new: true, runValidators: true }); return sendResponse(res, 200, "Seen shared to your profile", { engagement: await summary(req.params.id, req.user._id) }); });
export const removeSeenShare = asyncHandler(async (req, res) => { await publishedSeen(req.params.id); await SeenEngagement.deleteOne({ publication: req.params.id, user: req.user._id, type: "SHARE" }); return sendResponse(res, 200, "Seen removed from your profile", { engagement: await summary(req.params.id, req.user._id) }); });
export const toggleSeenSave = asyncHandler(async (req, res) => { await publishedSeen(req.params.id); const filter = { publication: req.params.id, user: req.user._id, type: "SAVE" }; const existing = await SeenEngagement.findOne(filter); if (existing) await existing.deleteOne(); else await SeenEngagement.create(filter); return sendResponse(res, 200, existing ? "Seen removed from Saved" : "Seen saved", { engagement: await summary(req.params.id, req.user._id) }); });
export const markWorldWalked = asyncHandler(async (req, res) => { const publication = await publishedPlanet(req.params.id); await SeenEngagement.findOneAndUpdate({ publication: publication._id, user: req.user._id, type: "WALKED" }, { $setOnInsert: { publication: publication._id, user: req.user._id, type: "WALKED" } }, { upsert: true, new: true }); return sendResponse(res, 200, "World marked as walked", { walked: true, publication: { id: publication._id, title: publication.title } }); });
