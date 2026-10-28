import mongoose from "mongoose";
import Publication from "../models/Publication.js";
import WallPost from "../models/WallPost.js";
import FeedPost from "../models/FeedPost.js";
import SeenEngagement from "../models/SeenEngagement.js";
import WallEngagement from "../models/WallEngagement.js";
import WallShareEngagement from "../models/WallShareEngagement.js";
import ProfileMedia from "../models/ProfileMedia.js";
import Repost from "../models/Repost.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

const commentModels = { SeenEngagement, WallEngagement, WallShareEngagement };

async function resolveTarget(kind, id, requestedModel) {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(400, "Invalid repost target");
  if (kind === "seen") { const item = await Publication.findOne({ _id: id, kind: "SEEN", status: "PUBLISHED" }); return item && { item, model: "Publication", author: item.creator }; }
  if (kind === "note") {
    const WallModel = requestedModel === "FeedPost" ? FeedPost : WallPost;
    const item = await WallModel.findOne({ _id: id, status: requestedModel === "FeedPost" ? "published" : "PUBLISHED", ...(requestedModel === "FeedPost" ? { deletedAt: null } : {}) });
    return item && { item, model: requestedModel === "FeedPost" ? "FeedPost" : "WallPost", author: item.author || item.creator };
  }
  if (kind === "photo") { const item = await ProfileMedia.findOne({ _id: id, type: "image" }); return item && { item, model: "ProfileMedia", author: item.user }; }
  if (kind === "cm") {
    if (requestedModel === "FeedPost") {
      const post = await FeedPost.findOne({ "comments._id": id, status: "published", deletedAt: null }).select("comments");
      const item = post?.comments?.id(id);
      return item && { item, model: "FeedPost", author: item.user };
    }
    const Model = commentModels[requestedModel];
    if (!Model) throw new ApiError(400, "Comment source is required");
    const item = await Model.findOne({ _id: id, type: "COMMENT" });
    return item && { item, model: requestedModel, author: item.user };
  }
  throw new ApiError(400, "Unsupported repost kind");
}

export const toggleRepost = asyncHandler(async (req, res) => {
  const target = await resolveTarget(req.params.kind, req.params.id, req.body.targetModel);
  if (!target) throw new ApiError(404, "Repost target not found");
  if (String(target.author) === String(req.user._id)) throw new ApiError(409, "You cannot repost your own content");
  const filter = { user: req.user._id, kind: req.params.kind, targetId: target.item._id };
  const existing = await Repost.findOne(filter);
  if (existing) await existing.deleteOne();
  else await Repost.create({ ...filter, targetModel: target.model, originalAuthor: target.author });
  return sendResponse(res, 200, existing ? "Repost removed" : "Reposted to your profile", { reposted: !existing });
});
