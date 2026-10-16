import { wallPostCaption } from "../services/wallPostDisplayService.js";
import mongoose from "mongoose";
import rateLimit from "express-rate-limit";
import FeedPost from "../models/FeedPost.js";
import UserBlock from "../models/UserBlock.js";
import CreatorProfile from "../models/CreatorProfile.js";
import FanProfile from "../models/FanProfile.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { wallTranslationMetadata, translateWallContent } from "../services/wallTranslationService.js";

export const wallTranslationLimiter = rateLimit({ windowMs: 60 * 1000, limit: 90, keyGenerator: (req) => String(req.user._id), standardHeaders: true, legacyHeaders: false });

export async function readWallTranslationContent(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid post ID");
  const post = await FeedPost.findOne({ _id: req.params.id, status: "published", deletedAt: null });
  if (!post) throw new ApiError(404, "Post not found");
  const owner = String(post.author) === String(req.user._id);
  if ((!owner && post.visibility !== "public") || (post.hiddenBy || []).some((entry) => String(entry.user) === String(req.user._id))) throw new ApiError(404, "Post not found");
  if (await UserBlock.exists({ $or: [{ blocker: req.user._id, blocked: post.author }, { blocker: post.author, blocked: req.user._id }] })) throw new ApiError(404, "Post not found");
  const mediaId = String(req.query.mediaId || req.body?.mediaId || "");
  const media = mediaId ? post.media.find((item) => item.type === "audio" && [String(item._id), item.assetId].includes(mediaId)) : null;
  if (mediaId && !media) throw new ApiError(404, "Voice note not found");
  const text = media ? media.transcript : wallPostCaption(post.text, post.media);
  const Profile = req.user.creatorApprovalStatus === "approved" ? CreatorProfile : FanProfile;
  const profile = await Profile.findOne({ user: req.user._id }).select("preferredLanguage").lean();
  return { text, preferredLanguage: profile?.preferredLanguage || "en" };
}

export const getWallContentLanguage = asyncHandler(async (req, res) => {
  const data = await readWallTranslationContent(req);
  return sendResponse(res, 200, "Post language detected", await wallTranslationMetadata(data));
});
export const translateWallPostContent = asyncHandler(async (req, res) => {
  const data = await readWallTranslationContent(req);
  return sendResponse(res, 200, "Post translation fetched", await translateWallContent(data));
});
