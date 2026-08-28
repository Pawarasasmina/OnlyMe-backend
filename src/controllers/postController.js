import mongoose from "mongoose";
import FeedPost from "../models/FeedPost.js";
import MessageReport from "../models/MessageReport.js";
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
import { deleteFeedPostMedia, uploadFeedPostImage, uploadFeedPostVoice } from "../services/feedPostMediaStorageService.js";
import { recordChecklistEvent } from "../services/onboardingService.js";
import { listSupportedTranslationLanguages } from "../services/translationService.js";
import { normalizeVoiceLanguageCode } from "../../../shared/voiceTranslationLanguages.js";

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

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function feedFilterQuery(query = {}) {
  const filter = String(query.filter || query.context || "all").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const location = cleanString(query.location || query.city, POST_LOCATION_MAX_LENGTH);
  const extra = {};

  if (filter && filter !== "all") {
    if (filter === "right_now") extra.context = "Right now";
    else if (filter === "events") extra.context = "Events";
    else if (filter === "things_to_do") extra.context = "Things to do";
    else if (filter === "food") extra.context = { $in: ["Coffee", "Restaurant"] };
    else if (filter === "places") extra.location = { $ne: "" };
    else {
      const exact = POST_CONTEXTS.find((context) => context.toLowerCase().replace(/[\s-]+/g, "_") === filter);
      if (exact) extra.context = exact;
    }
  }

  if (location) {
    const matcher = { $regex: escapeRegex(location), $options: "i" };
    extra.location = extra.location && typeof extra.location === "object" && "$ne" in extra.location
      ? { ...extra.location, ...matcher }
      : matcher;
  }

  return extra;
}

export const postControllerTestUtils = { feedFilterQuery };

function ensureCreatable({ hasVoice = false, imageFiles = [], status, text }) {
  if (imageFiles.length > POST_MAX_IMAGES) {
    throw new ApiError(400, `A post can include up to ${POST_MAX_IMAGES} images`);
  }

  if (status === "published" && !text && !hasVoice) {
    throw new ApiError(400, "Post text or a voice note is required");
  }

  if (status === "draft" && !text && !imageFiles.length && !hasVoice) {
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

export function serializePost(post, viewer = null, activity = {}) {
  return serializePostFeedItem(post, viewer, activity);
}

function serializePostFeedItem(post, viewer = null, activity = {}) {
  const author = post.author || {};
  const authorId = String(author._id || author.id || author);
  const viewerId = viewer?._id ? String(viewer._id) : "";
  const reactions = post.reactions || [];
  const comments = (post.comments || []).filter((comment) => !comment.deletedAt);
  const saves = post.saves || [];
  const views = post.views || [];
  const shares = post.shares || [];
  const hiddenBy = post.hiddenBy || [];
  const viewerReaction = viewerId
    ? reactions.find((item) => String(item.user?._id || item.user) === viewerId)?.reaction || null
    : null;
  const viewerSaved = Boolean(viewerId && saves.some((item) => String(item.user?._id || item.user) === viewerId));
  const viewerViewed = Boolean(viewerId && views.some((item) => String(item.user?._id || item.user) === viewerId));
  const viewerShared = Boolean(viewerId && shares.some((item) => String(item.user?._id || item.user) === viewerId));
  const viewerHidden = Boolean(viewerId && hiddenBy.some((item) => String(item.user?._id || item.user) === viewerId));

  return {
    id: activity.feedId || String(post._id),
    originalPostId: String(post._id),
    shareId: activity.shareId || null,
    sharedBy: activity.sharedBy || null,
    shareCaption: activity.shareCaption || "",
    feedCreatedAt: activity.feedCreatedAt || post.publishedAt || post.createdAt,
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
        duration: item.duration || null,
        mimeType: item.mimeType || "",
        transcript: item.transcript || "",
        transcriptLanguage: item.transcriptLanguage || "",
        translations: (item.translations || []).map((translation) => ({
          language: translation.language,
          languageName: translation.languageName || "",
          text: translation.text,
        })),
        waveform: item.waveform || [],
      })),
    visibility: post.visibility,
    status: post.status,
    reactions: reactionSummary(reactions),
    viewerReaction,
    viewerSaved,
    viewerViewed,
    viewerShared,
    viewerHidden,
    comments: comments.map(serializeComment),
    supportCount: reactions.length || post.supportCount || 0,
    commentCount: comments.length || post.commentCount || 0,
    saveCount: saves.length || post.saveCount || 0,
    viewCount: Number(post.viewCount ?? views.length) || 0,
    shareCount: shares.length || post.shareCount || 0,
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

function readWaveform(value) {
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item) && item >= 0)
      .slice(0, 100);
  } catch {
    return [];
  }
}

async function readVoiceTranslations(value, transcript = "") {
  if (!value) return [];

  let parsed;
  try {
    parsed = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw new ApiError(400, "Voice translations must be valid JSON", "INVALID_TRANSLATIONS");
  }

  if (!Array.isArray(parsed)) {
    throw new ApiError(400, "Voice translations must be an array", "INVALID_TRANSLATIONS");
  }

  const currentTranscript = cleanString(transcript, POST_TEXT_MAX_LENGTH);
  const languages = new Set();
  const supportedLanguages = await listSupportedTranslationLanguages();
  const supportedByCode = new Map(supportedLanguages.map((language) => [language.code, language]));

  return parsed.map((entry) => {
    const language = normalizeVoiceLanguageCode(entry?.language);
    const text = cleanString(entry?.text, POST_TEXT_MAX_LENGTH);
    const sourceText = Object.hasOwn(entry || {}, "sourceText") ? cleanString(entry.sourceText, POST_TEXT_MAX_LENGTH) : currentTranscript;

    if (!language || !text) {
      throw new ApiError(400, "Each voice translation requires language and text", "INVALID_TRANSLATIONS");
    }

    const supportedLanguage = supportedByCode.get(language);
    if (!supportedLanguage) {
      throw new ApiError(400, "Unsupported translation language.", "UNSUPPORTED_LANGUAGE");
    }

    if (languages.has(language)) {
      throw new ApiError(400, "Duplicate translation language.", "DUPLICATE_TRANSLATION_LANGUAGE");
    }

    if (sourceText !== currentTranscript) {
      throw new ApiError(400, "Voice translations must match the current transcript.", "STALE_TRANSLATION");
    }

    languages.add(language);
    return { language, languageName: supportedLanguage.name, text };
  });
}

async function uploadPostMedia({ imageFiles = [], post, req, userId, voiceFile = null }) {
  const uploaded = [];
  try {
    for (const [index, file] of imageFiles.entries()) {
      uploaded.push(await uploadFeedPostImage({ file, postId: post._id, userId, sortOrder: index }));
    }
    if (voiceFile) {
      const transcript = cleanString(req.body.voiceTranscript, POST_TEXT_MAX_LENGTH);
      const transcriptLanguage = normalizeVoiceLanguageCode(req.body.voiceTranscriptLanguage);

      uploaded.push(await uploadFeedPostVoice({
        file: voiceFile,
        postId: post._id,
        sortOrder: uploaded.length,
        transcript,
        transcriptLanguage,
        translations: await readVoiceTranslations(req.body.voiceTranslations, transcript),
        userId,
        waveform: readWaveform(req.body.voiceWaveform),
      }));
    }
    return uploaded;
  } catch (error) {
    await deleteFeedPostMedia(uploaded);
    throw error;
  }
}

async function createPostRecord({ imageFiles = [], req, status, voiceFile = null }) {
  const text = cleanString(req.body.text, POST_TEXT_MAX_LENGTH);
  const context = readContext(req.body.context);
  const location = readLocation(req.body.location);
  ensureCreatable({ hasVoice: Boolean(voiceFile), imageFiles, status, text });

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
  const media = imageFiles.length || voiceFile ? await uploadPostMedia({ imageFiles, post, req, userId: req.user._id, voiceFile }) : [];
  post.media = media;

  try {
    await post.save();
  } catch (error) {
    await deleteFeedPostMedia(media);
    throw error;
  }

  await populatePostForResponse(post);
  return post;
}

export const listFeedPosts = asyncHandler(async (req, res) => {
  const { page, limit } = pageOptions(req);
  const blocks = await UserBlock.find({ $or: [{ blocker: req.user._id }, { blocked: req.user._id }] }).select("blocker blocked").lean();
  const blockedAuthorIds = blocks.map((block) => String(block.blocker) === String(req.user._id) ? block.blocked : block.blocker);
  const blockedIdSet = new Set(blockedAuthorIds.map((id) => String(id)));
  const filter = {
    status: "published",
    deletedAt: null,
    author: { $nin: blockedAuthorIds },
    "hiddenBy.user": { $ne: req.user._id },
    ...feedFilterQuery(req.query),
  };
  const fetchLimit = Math.min(150, Math.max(limit * page * 2, limit));
  const [items, sharedSourcePosts, total] = await Promise.all([
    FeedPost.find(filter)
      .sort({ publishedAt: -1, createdAt: -1 })
      .limit(fetchLimit)
      .populate([
        { path: "author", select: "name username avatar isVerified" },
        { path: "comments.user", select: "name username avatar isVerified" },
      ])
      .lean(),
    FeedPost.find({ ...filter, "shares.0": { $exists: true } })
      .sort({ "shares.createdAt": -1 })
      .limit(fetchLimit)
      .populate([
        { path: "author", select: "name username avatar isVerified" },
        { path: "comments.user", select: "name username avatar isVerified" },
        { path: "shares.user", select: "name username avatar isVerified role status" },
      ])
      .lean(),
    FeedPost.countDocuments(filter),
  ]);

  const sharedItems = sharedSourcePosts.flatMap((post) => (post.shares || [])
    .filter((share) => share.user && String(share.user.status || "active") === "active" && !blockedIdSet.has(String(share.user._id || share.user)))
    .map((share) => serializePostFeedItem(post, req.user, {
      feedId: `share-${share._id}`,
      shareId: String(share._id),
      feedCreatedAt: share.createdAt,
      shareCaption: share.caption || "",
      sharedBy: authorPayload(share.user),
    })));
  const originalItems = items.map((item) => serializePostFeedItem(item, req.user));
  const mergedItems = [...originalItems, ...sharedItems]
    .sort((left, right) => new Date(right.feedCreatedAt || right.publishedAt || right.createdAt) - new Date(left.feedCreatedAt || left.publishedAt || left.createdAt));
  const offset = (page - 1) * limit;

  return sendResponse(res, 200, "Feed posts fetched", {
    items: mergedItems.slice(offset, offset + limit),
    pagination: { page, limit, total: total + sharedItems.length, pages: Math.ceil((total + sharedItems.length) / limit) },
  });
});

export const getFeedPost = asyncHandler(async (req, res) => {
  const post = await findPublishedPost(req.params.id);
  const authorId = post.author?._id || post.author;
  const blocked = await UserBlock.exists({ $or: [{ blocker: req.user._id, blocked: authorId }, { blocker: authorId, blocked: req.user._id }] });
  if (blocked || post.hiddenBy.some((item) => String(item.user) === String(req.user._id))) {
    throw new ApiError(404, "Post not found");
  }
  await populatePostForResponse(post);
  return sendResponse(res, 200, "Feed post fetched", { post: serializePost(post, req.user) });
});

export const markFeedPostViewed = asyncHandler(async (req, res) => {
  const post = await findPublishedPost(req.params.id);
  const authorId = post.author?._id || post.author;
  const viewerId = req.user._id;
  const currentCount = Number(post.viewCount ?? post.views?.length) || 0;

  const blocked = await UserBlock.exists({ $or: [{ blocker: viewerId, blocked: authorId }, { blocker: authorId, blocked: viewerId }] });
  if (blocked || post.hiddenBy.some((item) => String(item.user) === String(viewerId))) {
    throw new ApiError(404, "Post not found");
  }

  if (String(authorId) === String(viewerId)) {
    return sendResponse(res, 200, "Own post view ignored", {
      postId: String(post._id),
      viewCount: currentCount,
      viewed: false,
    });
  }

  const updated = await FeedPost.findOneAndUpdate(
    { _id: post._id, "views.user": { $ne: viewerId } },
    { $push: { views: { user: viewerId, viewedAt: new Date() } }, $inc: { viewCount: 1 } },
    { new: true, runValidators: true, select: "viewCount views" }
  ).lean();

  return sendResponse(res, 200, updated ? "Post view recorded" : "Post view already recorded", {
    postId: String(post._id),
    viewCount: Number(updated?.viewCount ?? currentCount) || 0,
    viewed: Boolean(updated),
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
  const files = req.files || {};
  const post = await createPostRecord({ imageFiles: files.media || [], req, status: "published", voiceFile: files.voice?.[0] || null });
  await recordChecklistEvent(req.user._id, "createdFirstPost");
  return sendResponse(res, 201, "Post published", { post: serializePost(post, req.user) });
});

export const createDraftPost = asyncHandler(async (req, res) => {
  const post = await createPostRecord({ imageFiles: req.files || [], req, status: "draft" });
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

export const togglePostShare = asyncHandler(async (req, res) => {
  const post = await findPublishedPost(req.params.id);
  const userId = String(req.user._id);
  const existing = post.shares.find((item) => String(item.user) === userId);

  if (existing) {
    post.shares = post.shares.filter((item) => String(item.user) !== userId);
  } else {
    post.shares.push({ user: req.user._id, caption: cleanString(req.body.caption, 500) });
  }

  post.shareCount = post.shares.length;
  await post.save();
  await populatePostForResponse(post);
  await post.populate({ path: "shares.user", select: "name username avatar isVerified role status" });
  return sendResponse(res, 200, existing ? "Post removed from your profile" : "Post shared to your profile", { post: serializePost(post, req.user) });
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
  if (String(post.author) === String(req.user._id)) throw new ApiError(400, "You cannot report your own post");
  const reason = cleanString(req.body.reason || "OTHER", 80).toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_");
  const allowed = new Set(["SPAM", "FALSE_INFORMATION", "HARASSMENT", "HATE", "NUDITY", "SEXUAL_CONTENT", "VIOLENCE", "ILLEGAL_CONTENT", "COPYRIGHT", "SCAM", "OTHER"]);
  if (!allowed.has(reason)) throw new ApiError(400, "Select a valid report reason");
  try {
    const report = await MessageReport.create({
      reporter: req.user._id,
      reportedUser: post.author,
      scope: "FEED_POST",
      feedPost: post._id,
      reason,
      details: cleanString(req.body.details, 1000),
      snapshot: {
        postId: String(post._id),
        authorId: String(post.author),
        text: post.text,
        context: post.context,
        media: post.media.map(({ url, type }) => ({ url, type })),
        createdAt: post.createdAt,
      },
    });
    return sendResponse(res, 201, "Post report received", { reportId: String(report._id), status: report.status });
  } catch (error) {
    if (error?.code === 11000) throw new ApiError(409, "You already reported this post");
    throw error;
  }
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
