import mongoose from "mongoose";
import FeedPost from "../models/FeedPost.js";
import UserBlock from "../models/UserBlock.js";
import { wallActiveExpression } from "../services/wallLifecycleService.js";
import { publicWallModerationFilter } from "../services/wallModerationAccess.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

export const flagRecommendationOutdated = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid post ID");
  if (req.user.status !== "active" || req.user.accountType === "TEST") throw new ApiError(403, "This account cannot submit freshness feedback");
  const filter = { _id: req.params.id, author: { $ne: req.user._id }, postType: "Recommendation", rightNow: { $ne: true }, status: "published", visibility: "public", deletedAt: null, ...publicWallModerationFilter, $expr: wallActiveExpression() };
  const post = await FeedPost.findOne(filter).select("author hiddenBy").lean();
  if (!post || (post.hiddenBy || []).some(entry => String(entry.user) === String(req.user._id)) || await UserBlock.exists({ $or: [{ blocker: req.user._id, blocked: post.author }, { blocker: post.author, blocked: req.user._id }] })) throw new ApiError(404, "Recommendation not found");
  const updated = await FeedPost.findOneAndUpdate(filter, { $addToSet: { outdatedVoters: req.user._id } }, { new: true });
  if (!updated) throw new ApiError(409, "This recommendation is no longer active");
  return sendResponse(res, 200, "Thanks. We'll ask the author to check this recommendation.", { voted: true });
});
