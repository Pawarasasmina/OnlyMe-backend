import mongoose from "mongoose";
import FeedPost from "../models/FeedPost.js";
import UserBlock from "../models/UserBlock.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import {
  POST_CONTEXTS,
  POST_COMMENT_MAX_LENGTH,
  POST_LOCATION_MAX_LENGTH,
  POST_MAX_IMAGES,
  POST_REACTIONS,
  POST_TEXT_MAX_LENGTH,
} from "../constants/postConstants.js";
import { deleteFeedPostImages, uploadFeedPostImage } from "../services/feedPostMediaStorageService.js";
import { recordChecklistEvent } from "../services/onboardingService.js";

function pageOptions(req) {
  return {
    page: Math.max(1, Number(req.query.page) || 1),
    limit: Math.min(50, Math.max(1, Number(req.query.limit) || 20)),
  };
}

function cleanString(value, maxLength) {
  const clean = String(value || "").trim().replace(/\r\n/g, "\n");
  return clean.length > maxLength ? clean.slice(0, maxLength) : clean;
}

function readContext(value) {
  const context = cleanString(value, 40);
  if (!context) return "";
  if (!POST_CONTEXTS.includes(context)) {
    throw new ApiError(400, "Unsupported post context");
  }
  return context;
}

function readLocation(value) {
  return cleanString(value, POST_LOCATION_MAX_LENGTH);
}

function readCommentText(value) {
  const text = cleanString(value, POST_COMMENT_MAX_LENGTH);
  if (!text) {
    throw new ApiError(400, "Comment text is required");
  }
  return text;
}

function readReaction(value) {
  const reaction = cleanString(value, 20);
  if (!reaction) return "";
  if (!POST_REACTIONS.includes(reaction)) {
    throw new ApiError(400, "Unsupported post reaction");
  }
  return reaction;
}

function ensureCreatable({ files = [], status, text }) {
  if (files.length > POST_MAX_IMAGES) {
    throw new ApiError(400, `A post can include up to ${POST_MAX_IMAGES} images`);
  }

  if (status === "published" && !text) {
    throw new ApiError(400, "Post text is required");
  }

  if (status === "draft" && !text && !files.length) {
    throw new ApiError(400, "Add text or images before saving a draft");
  }
}

function authorPayload(author) {
  return {
    id: String(author?._id || author?.id || ""),
    name: author?.name || "Creator",
    username: author?.username || "creator",
    avatar: author?.avatar || "",
    verified: Boolean(author?.isVerified),
  };
}

function serializeComment(comment) {
  const user = comment.user || {};
  return {
    id: String(comment._id),
    text: comment.text || "",
    createdAt: comment.createdAt,
    author: authorPayload(user),
  };
}

function reactionSummary(reactions = []) {
  const counts = new Map();
  for (const item of reactions) {
    if (!item?.reaction) continue;
    counts.set(item.reaction, (counts.get(item.reaction) || 0) + 1);
  }
  return POST_REACTIONS
    .map((reaction) => ({ reaction, count: counts.get(reaction) || 0 }))
    .filter((item) => item.count > 0);
}

export function serializePost(post, viewer = null) {
  const author = post.author || {};
  const authorId = String(author._id || author.id || author);
  const viewerId = viewer?._id ? String(viewer._id) : "";
  const reactions = post.reactions || [];
  const comments = (post.comments || []).filter((comment) => !comment.deletedAt);
  const saves = post.saves || [];
  const hiddenBy = post.hiddenBy || [];
  const viewerReaction = viewerId
    ? reactions.find((item) => String(item.user?._id || item.user) === viewerId)?.reaction || null
    : null;
  const viewerSaved = Boolean(viewerId && saves.some((item) => String(item.user?._id || item.user) === viewerId));
  const viewerHidden = Boolean(viewerId && hiddenBy.some((item) => String(item.user?._id || item.user) === viewerId));

  return {
    id: String(post._id),
    author: authorPayload(author),
    text: post.text || "",
    context: post.context || "",
    location: post.location || "",
    media: (post.media || [])
      .slice()
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      .map((item) => ({
        id: String(item._id || item.assetId),
        assetId: item.assetId,
        url: item.url,
        type: item.type || "image",
        width: item.width || null,
        height: item.height || null,
        bytes: item.bytes || null,
        format: item.format || "",
      })),
    visibility: post.visibility,
    status: post.status,
    reactions: reactionSummary(reactions),
    viewerReaction,
    viewerSaved,
    viewerHidden,
    comments: comments.map(serializeComment),
    supportCount: reactions.length || post.supportCount || 0,
    commentCount: comments.length || post.commentCount || 0,
    saveCount: saves.length || post.saveCount || 0,
    reportCount: (post.reports || []).length,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    publishedAt: post.publishedAt,
    isOwner: Boolean(viewerId && authorId === viewerId),
  };
}

async function findPublishedPost(postId) {
  if (!mongoose.isValidObjectId(postId)) {
    throw new ApiError(400, "Invalid post ID");
  }

  const post = await FeedPost.findOne({ _id: postId, status: "published", deletedAt: null });
  if (!post) {
    throw new ApiError(404, "Post not found");
  }
  return post;
}

async function populatePostForResponse(post) {
  await post.populate([
    { path: "author", select: "name username avatar isVerified" },
    { path: "comments.user", select: "name username avatar isVerified" },
  ]);
  return post;
}

async function uploadPostFiles({ files = [], post, userId }) {
  const uploaded = [];
  try {
    for (const [index, file] of files.entries()) {
      uploaded.push(await uploadFeedPostImage({ file, postId: post._id, userId, sortOrder: index }));
    }
    return uploaded;
  } catch (error) {
    await deleteFeedPostImages(uploaded);
    throw error;
  }
}

async function createPostRecord({ files, req, status }) {
  const text = cleanString(req.body.text, POST_TEXT_MAX_LENGTH);
  const context = readContext(req.body.context);
  const location = readLocation(req.body.location);
  ensureCreatable({ files, status, text });

  const post = new FeedPost({
    author: req.user._id,
    text,
    context,
    location,
    media: [],
    status,
    visibility: status === "draft" ? "private" : "public",
    publishedAt: status === "published" ? new Date() : null,
  });

  await post.validate();
  const media = files.length ? await uploadPostFiles({ files, post, userId: req.user._id }) : [];
  post.media = media;

  try {
    await post.save();
  } catch (error) {
    await deleteFeedPostImages(media);
    throw error;
  }

  await populatePostForResponse(post);
  return post;
}

export const listFeedPosts = asyncHandler(async (req, res) => {
  const { page, limit } = pageOptions(req);
  const blocks = await UserBlock.find({ $or: [{ blocker: req.user._id }, { blocked: req.user._id }] }).select("blocker blocked").lean();
  const blockedAuthorIds = blocks.map((block) => String(block.blocker) === String(req.user._id) ? block.blocked : block.blocker);
  const filter = {
    status: "published",
    deletedAt: null,
    author: { $nin: blockedAuthorIds },
    "hiddenBy.user": { $ne: req.user._id },
  };
  const [items, total] = await Promise.all([
    FeedPost.find(filter)
      .sort({ publishedAt: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate([
        { path: "author", select: "name username avatar isVerified" },
        { path: "comments.user", select: "name username avatar isVerified" },
      ])
      .lean(),
    FeedPost.countDocuments(filter),
  ]);

  return sendResponse(res, 200, "Feed posts fetched", {
    items: items.map((item) => serializePost(item, req.user)),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

export const listMyPosts = asyncHandler(async (req, res) => {
  const { page, limit } = pageOptions(req);
  const status = req.query.status === "draft" ? "draft" : "published";
  const [items, total] = await Promise.all([
    FeedPost.find({ author: req.user._id, status, deletedAt: null })
      .sort(status === "draft" ? { updatedAt: -1 } : { publishedAt: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate([
        { path: "author", select: "name username avatar isVerified" },
        { path: "comments.user", select: "name username avatar isVerified" },
      ])
      .lean(),
    FeedPost.countDocuments({ author: req.user._id, status, deletedAt: null }),
  ]);

  return sendResponse(res, 200, status === "draft" ? "Draft posts fetched" : "Creator posts fetched", {
    items: items.map((item) => serializePost(item, req.user)),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

export const createFeedPost = asyncHandler(async (req, res) => {
  const post = await createPostRecord({ files: req.files || [], req, status: "published" });
  await recordChecklistEvent(req.user._id, "createdFirstPost");
  return sendResponse(res, 201, "Post published", { post: serializePost(post, req.user) });
});

export const createDraftPost = asyncHandler(async (req, res) => {
  const post = await createPostRecord({ files: req.files || [], req, status: "draft" });
  return sendResponse(res, 201, "Draft saved", { post: serializePost(post, req.user) });
});

export const updateFeedPost = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new ApiError(400, "Invalid post ID");
  }

  const post = await FeedPost.findOne({ _id: req.params.id, author: req.user._id, deletedAt: null });
  if (!post) {
    throw new ApiError(404, "Post not found");
  }

  const text = cleanString(req.body.text, POST_TEXT_MAX_LENGTH);
  const context = readContext(req.body.context);
  const location = readLocation(req.body.location);

  if (post.status === "published" && !text) {
    throw new ApiError(400, "Post text is required");
  }

  post.text = text;
  post.context = context;
  post.location = location;

  if (post.status === "draft" && req.body.publish === "true") {
    if (!text) throw new ApiError(400, "Post text is required");
    post.status = "published";
    post.visibility = "public";
    post.publishedAt = new Date();
  }

  await post.save();
  if (post.status === "published") await recordChecklistEvent(req.user._id, "createdFirstPost");
  await populatePostForResponse(post);
  return sendResponse(res, 200, post.status === "published" ? "Post updated" : "Draft updated", { post: serializePost(post, req.user) });
});

export const updatePostReaction = asyncHandler(async (req, res) => {
  const post = await findPublishedPost(req.params.id);
  const reaction = readReaction(req.body.reaction);
  const userId = String(req.user._id);
  const existing = post.reactions.find((item) => String(item.user) === userId);

  if (!reaction) {
    post.reactions = post.reactions.filter((item) => String(item.user) !== userId);
  } else if (existing) {
    existing.reaction = reaction;
  } else {
    post.reactions.push({ user: req.user._id, reaction });
  }

  post.supportCount = post.reactions.length;
  await post.save();
  await populatePostForResponse(post);
  return sendResponse(res, 200, reaction ? "Reaction saved" : "Reaction removed", { post: serializePost(post, req.user) });
});

export const togglePostSave = asyncHandler(async (req, res) => {
  const post = await findPublishedPost(req.params.id);
  const userId = String(req.user._id);
  const existing = post.saves.find((item) => String(item.user) === userId);

  if (existing) {
    post.saves = post.saves.filter((item) => String(item.user) !== userId);
  } else {
    post.saves.push({ user: req.user._id });
  }

  post.saveCount = post.saves.length;
  await post.save();
  await populatePostForResponse(post);
  return sendResponse(res, 200, existing ? "Post removed from Saved" : "Post saved", { post: serializePost(post, req.user) });
});

export const hideFeedPost = asyncHandler(async (req, res) => {
  const post = await findPublishedPost(req.params.id);
  const userId = String(req.user._id);
  if (!post.hiddenBy.some((item) => String(item.user) === userId)) {
    post.hiddenBy.push({ user: req.user._id, reason: cleanString(req.body.reason || "NOT_USEFUL", 80) || "NOT_USEFUL" });
    await post.save();
  }
  return sendResponse(res, 200, "Post hidden from your feed", { postId: String(post._id), hidden: true });
});

export const reportFeedPost = asyncHandler(async (req, res) => {
  const post = await findPublishedPost(req.params.id);
  const reason = cleanString(req.body.reason || "Other", 80);
  if (!reason) throw new ApiError(400, "Report reason is required");
  const userId = String(req.user._id);
  const existing = post.reports.find((item) => String(item.user) === userId && ["RECEIVED", "REVIEWING"].includes(item.status));
  if (existing) {
    existing.reason = reason;
    existing.details = cleanString(req.body.details, 1000);
  } else {
    post.reports.push({ user: req.user._id, reason, details: cleanString(req.body.details, 1000) });
  }
  await post.save();
  const report = post.reports.find((item) => String(item.user) === userId && item.reason === reason);
  return sendResponse(res, 201, "Post report received", { reportId: String(report?._id || ""), status: report?.status || "RECEIVED" });
});

export const blockPostAuthor = asyncHandler(async (req, res) => {
  const post = await findPublishedPost(req.params.id);
  const authorId = post.author?._id || post.author;
  if (String(authorId) === String(req.user._id)) {
    throw new ApiError(400, "You cannot block yourself");
  }
  await UserBlock.updateOne(
    { blocker: req.user._id, blocked: authorId },
    { $setOnInsert: { blocker: req.user._id, blocked: authorId } },
    { upsert: true },
  );
  return sendResponse(res, 200, "Account blocked", { blockedUserId: String(authorId), blockedByMe: true });
});

export const createPostComment = asyncHandler(async (req, res) => {
  const post = await findPublishedPost(req.params.id);
  post.comments.push({ user: req.user._id, text: readCommentText(req.body.text) });
  post.commentCount = post.comments.filter((comment) => !comment.deletedAt).length;
  await post.save();
  await populatePostForResponse(post);
  return sendResponse(res, 201, "Comment saved", { post: serializePost(post, req.user) });
});

export const deleteFeedPost = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new ApiError(400, "Invalid post ID");
  }

  const post = await FeedPost.findOne({ _id: req.params.id, author: req.user._id, deletedAt: null });
  if (!post) {
    throw new ApiError(404, "Post not found");
  }

  post.status = "deleted";
  post.deletedAt = new Date();
  await post.save();
  return sendResponse(res, 200, "Post deleted", { postId: String(post._id) });
});
