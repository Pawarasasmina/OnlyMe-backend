import { assertWallEditAllowed, canEditWallNote, wallEditDeadline, wallNoteVersion } from "../services/wallEditService.js";
import { canReadWallNote, publicWallModerationFilter } from "../services/wallModerationAccess.js";
import { wallViewCount } from "../services/wallViewCount.js";
import { assertNotExactWallCopy, cleanupWallFiles, creationKey, reserveWallCreation, validateWallCreation, validateWallPublishingText, findRecentWallCopy, queueWallCopyReview, registerWallEdit, wallFingerprint } from "../services/wallCreationService.js";
import { wallActiveExpression, wallClosedReason, wallBumpExpression, wallCanBump, wallExpiresAt, wallLifetimeDays, wallNeedsExpiryPrompt, wallPromptKind, wallLifecycleStatus } from "../services/wallLifecycleService.js";
import { prepareWallVoiceTranscript } from "../services/transcriptionService.js";
import { isRequestWallPost, wallResolutionTarget } from "../services/wallResolutionService.js";
import { readWallFeedFilters, wallFeedPipeline } from "../services/wallFeedFilterService.js";
import { readWallPrice } from "../services/wallPriceService.js";
import mongoose from "mongoose";
import FeedPost from "../models/FeedPost.js";
import MessageReport from "../models/MessageReport.js";
import { wallReporterQualification } from "../services/wallReportService.js";
import SavedItem from "../models/SavedItem.js";
import UserBlock from "../models/UserBlock.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendCommentResponse as sendResponse } from "../services/commentBadgeService.js";
import {
  POST_CONTEXTS,
  POST_COMMENT_MAX_LENGTH,
  POST_LOCATION_MAX_LENGTH,
  POST_MAX_IMAGES,
  POST_REACTIONS,
  POST_TEXT_MAX_LENGTH,
} from "../constants/postConstants.js";
import { deleteFeedPostMedia, uploadFeedPostImage, uploadFeedPostVoice } from "../services/feedPostMediaStorageService.js";
import { attachEntityMetadata, validateEntityRefs } from "../services/contentEntityService.js";
import { recordChecklistEvent } from "../services/onboardingService.js";
import { recordAnalyticsEvent, readAnalyticsSessionId } from "../services/analyticsEventService.js";
import { listSupportedTranslationLanguages } from "../services/translationService.js";
import { messageVoiceUrl, uploadMessageVoice } from "../services/messageVoiceStorageService.js";
import { getVoiceLanguageName, normalizeVoiceLanguageCode, resolveSupportedVoiceLanguage } from "../constants/voiceTranslationLanguages.js";
import { personalizeCandidates } from "../services/recommendationService.js";
import { syncRepost } from "../services/repostService.js";
import Repost from "../models/Repost.js";

function pageOptions(req) {
  const page = Math.floor(Number(req.query.page));
  const limit = Math.floor(Number(req.query.limit));
  return {
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    limit: Number.isSafeInteger(limit) && limit > 0 ? Math.min(50, limit) : 20,
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
    if (filter === "right_now") { extra.$or = [{ rightNow: true }, { postType: "Right Now" }, { context: "Right now" }]; extra.$expr = wallActiveExpression(); }
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

export function preserveWallTrustOrder(items, rows) {
  const penalties = new Map(rows.map(row => [String(row.__activity?.shareId ? `share-${row.__activity.shareId}` : row._id), Number(row.__trustPenalty) || 0]));
  return [...items].sort((a, b) => (penalties.get(String(a.id)) || 0) - (penalties.get(String(b.id)) || 0));
}

export const postControllerTestUtils = { feedFilterQuery, personalizeCandidates };

async function trackPostEvent(req, eventType, postId, extra = {}) {
  const sessionId = readAnalyticsSessionId(req);
  if (!sessionId) return null;
  return recordAnalyticsEvent({
    entityId: String(postId),
    entityType: "feed_post",
    eventType,
    metadata: extra.metadata || {},
    req,
    sessionId,
    source: extra.source || req.body.source || req.query.source || "home",
    userId: req.user._id,
  });
}

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

function serializeComment(comment, savedCommentIds = new Set(), viewerId = "", repostedCommentIds = new Set(), repostCountByComment = new Map()) {
  const user = comment.user || {};
  return {
    id: String(comment._id),
    text: comment.text || "",
    audio: comment.audio?.assetId ? { url: messageVoiceUrl(comment.audio), duration: comment.audio.duration, waveform: comment.audio.waveform || [] } : null,
    createdAt: comment.createdAt,
    parentCommentId: comment.parentCommentId ? String(comment.parentCommentId) : null,
    reactionCount: (comment.reactions || []).length,
    topReactions: reactionSummary(comment.reactions || []),
    viewerReaction: (comment.reactions || []).find(item => String(item.user?._id || item.user) === viewerId)?.reaction || null,
    author: authorPayload(user),
    viewerSaved: savedCommentIds.has(String(comment._id)),
    viewerReposted: repostedCommentIds.has(String(comment._id)),
    repostCount: repostCountByComment.get(String(comment._id)) || 0,
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

export const listPostReactors = asyncHandler(async (req, res) => {
  const post = await findPublishedPost(req.params.id, req.user);
  await post.populate("reactions.user", "name username avatar isVerified status");

  const reactions = (post.reactions || [])
    .filter((item) => item.user && String(item.user.status || "active") === "active")
    .sort((left, right) => new Date(right.updatedAt || right.createdAt) - new Date(left.updatedAt || left.createdAt))
    .map((item) => ({
      id: String(item._id),
      reactedAt: item.updatedAt || item.createdAt,
      reaction: item.reaction,
      user: {
        id: String(item.user._id),
        avatar: item.user.avatar || "",
        name: item.user.name || item.user.username || "Atseen user",
        username: item.user.username || "",
        verified: Boolean(item.user.isVerified),
      },
    }));
  const counts = Object.fromEntries(reactionSummary(post.reactions).map((item) => [item.reaction, item.count]));

  return sendResponse(res, 200, "Post reactions fetched", { counts, reactions, total: reactions.length });
});

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

  const savedCommentIds = post.savedCommentIds instanceof Set ? post.savedCommentIds : new Set(post.savedCommentIds || []);
  return {
    id: activity.feedId || String(post._id),
    originalPostId: String(post._id),
    shareId: activity.shareId || null,
    sharedBy: activity.sharedBy || null,
    shareCaption: activity.shareCaption || "",
    feedCreatedAt: activity.feedCreatedAt || post.bumpedAt || post.publishedAt || post.createdAt,
    bumpedAt: post.bumpedAt || null,
    editedAt: post.editedAt || null,
    editUntil: wallEditDeadline(post),
    editVersion: post.__v || 0,
    canEdit: Boolean(authorId === viewerId && canEditWallNote(post)),
    bumpCount: post.bumpCount || 0,
    outdatedConcern: (post.outdatedVoters || []).length >= 3,
    viewerFlaggedOutdated: (post.outdatedVoters || []).some(id => String(id) === viewerId),
    expiresAt: wallExpiresAt(post),
    expectedLifetimeDays: wallLifetimeDays(post),
    needsExpiryPrompt: Boolean(authorId === viewerId && post.status === "published" && !post.deletedAt && wallNeedsExpiryPrompt(post)),
    expiryPromptKind: wallPromptKind(post),
    lifecycleStatus: wallLifecycleStatus(post),
    canBump: authorId === viewerId && post.status === "published" && !post.deletedAt && wallCanBump(post),
    author: authorPayload(author),
    text: post.text || "",
    resolvedAt: post.resolvedAt || null,
    closedReason: wallClosedReason(post),
    isClosed: Boolean(wallClosedReason(post)),
    rightNow: Boolean(post.rightNow),
    canResolve: Boolean(viewerId && authorId === viewerId && post.status === "published" && (isRequestWallPost(post) || post.resolvedAt)),
    postType: post.postType || "",
    topic: post.topic || "",
    context: post.context || "",
    location: post.location || "",
    countryCode: post.countryCode || "",
    price: post.price ?? null,
    currency: post.currency || "",
    attachedEntities: post.attachedEntities || [],
    entityRefs: (post.entityRefs || []).map((ref) => ({
      entityId: String(ref.entityId),
      entityType: ref.entityType,
    })),
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
          languageName: translation.languageName || getVoiceLanguageName(translation.language),
          text: translation.text,
        })),
        waveform: item.waveform || [],
      })),
    visibility: post.visibility,
    status: post.status,
    reactions: reactionSummary(reactions),
    reactorPreviews: [...reactions].filter(item => item.user && typeof item.user === "object" && item.user.name).sort((a, b) => Number(String(b.user._id) === viewerId) - Number(String(a.user._id) === viewerId)).slice(0, 2).map(item => authorPayload(item.user)),
    viewerReaction,
    viewerSaved,
    viewerViewed,
    viewerShared,
    viewerHidden,
    comments: comments.map((comment) => serializeComment(comment, savedCommentIds, viewerId, post.repostedCommentIds || new Set(), post.repostCountByComment || new Map())),
    supportCount: reactions.length || post.supportCount || 0,
    commentCount: comments.length || post.commentCount || 0,
    saveCount: saves.length || post.saveCount || 0,
    viewCount: wallViewCount(post),
    shareCount: shares.length || post.shareCount || 0,
    privateShareCount: Number(post.privateShareCount || 0),
    ...(authorId === viewerId ? { moderationStatus: post.moderationStatus || "CLEAR", moderationHiddenAt: post.moderationHiddenAt || null } : {}),
    reportCount: (post.reports || []).length,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    publishedAt: post.publishedAt,
    isOwner: Boolean(viewerId && authorId === viewerId),
  };
}

async function findPublishedPost(postId, viewer) {
  if (!mongoose.isValidObjectId(postId)) {
    throw new ApiError(400, "Invalid post ID");
  }

  const post = await FeedPost.findOne({ _id: postId, status: "published", deletedAt: null });
  if (!post || !canReadWallNote(post, viewer)) {
    throw new ApiError(404, "Post not found");
  }
  return post;
}

async function populatePostForResponse(post) {
  await post.populate([
    { path: "author", select: "name username avatar isVerified" },
    { path: "comments.user", select: "name username avatar isVerified" },
    { path: "reactions.user", select: "name username avatar isVerified" },
  ]);
  return post;
}

async function attachSavedCommentState(posts, userId) {
  const list = Array.isArray(posts) ? posts : [posts];
  const commentIds = list.flatMap((post) => (post.comments || []).filter((comment) => !comment.deletedAt).map((comment) => comment._id));
  if (!commentIds.length) return posts;
  const [savedRows, repostedRows, countRows] = await Promise.all([
    userId ? SavedItem.find({ user: userId, targetType: "comment", targetModel: "FeedPostComment", targetId: { $in: commentIds } }).select("targetId").lean() : [],
    userId ? Repost.find({ user: userId, kind: "cm", targetModel: "FeedPost", targetId: { $in: commentIds } }).select("targetId").lean() : [],
    Repost.aggregate([{ $match: { kind: "cm", targetModel: "FeedPost", targetId: { $in: commentIds } } }, { $group: { _id: "$targetId", count: { $sum: 1 } } }]),
  ]);
  const savedIds = new Set(savedRows.map((row) => String(row.targetId)));
  const repostedIds = new Set(repostedRows.map((row) => String(row.targetId)));
  const repostCounts = new Map(countRows.map((row) => [String(row._id), row.count]));
  for (const post of list) { post.savedCommentIds = savedIds; post.repostedCommentIds = repostedIds; post.repostCountByComment = repostCounts; }
  return posts;
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

  return parsed.map((entry) => {
    const supportedLanguage = resolveSupportedVoiceLanguage(entry?.language, supportedLanguages);
    const language = supportedLanguage?.code || normalizeVoiceLanguageCode(entry?.language);
    const text = cleanString(entry?.text, POST_TEXT_MAX_LENGTH);
    const sourceText = Object.hasOwn(entry || {}, "sourceText") ? cleanString(entry.sourceText, POST_TEXT_MAX_LENGTH) : currentTranscript;

    if (!language || !text) {
      throw new ApiError(400, "Each voice translation requires language and text", "INVALID_TRANSLATIONS");
    }

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
      const { transcript, transcriptLanguage } = req.wallPreparedVoice || await prepareWallVoiceTranscript({
        file: voiceFile,
        transcript: cleanString(req.body.voiceTranscript, POST_TEXT_MAX_LENGTH),
        transcriptLanguage: normalizeVoiceLanguageCode(req.body.voiceTranscriptLanguage),
      });
      if (post.status === "published") validateWallPublishingText(`${post.text || ""} ${transcript || ""}`, req.user);

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
  const entityRefs = await validateEntityRefs(req.body.entityRefs);
  const location = readLocation(req.body.location);
  ensureCreatable({ hasVoice: Boolean(voiceFile), imageFiles, status, text });

  const post = new FeedPost({
    author: req.user._id,
    creationKey: status === "published" ? req.wallCreationKey : undefined,
    creationFingerprint: status === "published" ? req.wallFingerprint : undefined,
    moderationStatus: req.wallCopyEvidence ? "PENDING_REVIEW" : "CLEAR",
    moderationReason: req.wallCopyEvidence ? "RECENT_COPY" : "",
    moderationEvidence: req.wallCopyEvidence || null,
    rightNow: req.body.rightNow === true || req.body.rightNow === "true",
    postType: cleanString(req.body.postType, 40),
    topic: cleanString(req.body.topic, 40),
    text,
    context,
    location,
    countryCode: cleanString(req.body.countryCode, 2).toUpperCase(),
    ...readWallPrice(req.body.price, req.body.postType, location, req.body.countryCode),
    entityRefs,
    media: [],
    status,
    visibility: status === "draft" || req.wallCopyEvidence ? "private" : "public",
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

// Count original, unresolved notes once; shares must not inflate category totals.
export const getWallNeedCounts = asyncHandler(async (req, res) => {
  const options = readWallFeedFilters({ scope: req.query.scope || "worldwide", location: req.query.location, near: req.query.near });
  const blocks = await UserBlock.find({ $or: [{ blocker: req.user._id }, { blocked: req.user._id }] }).select("blocker blocked").lean();
  const blockedIds = blocks.map((block) => String(block.blocker) === String(req.user._id) ? block.blocked : block.blocker);
  const categories = ["need_help", "looking_for", "offering", "buy_sell", "question", "recommendation", "event"];
  const topics = ["meet_people", "work", "services", "housing", "places", "food", "travel", "kids_family", "community"];
  const sellMatch = readWallFeedFilters({ type: "buy_sell" }).match;
  const facets = Object.fromEntries(categories.map((category) => {
    const match = category === "buy_sell" ? sellMatch : readWallFeedFilters({ type: category }).match;
    return [category, [{ $match: category === "offering" ? { $and: [match, { $nor: [sellMatch] }] } : match }, { $count: "count" }]];
  }));
  for (const topic of topics) facets[`topic_${topic}`] = [{ $match: readWallFeedFilters({ topic }).match }, { $count: "count" }];
  // Return a small, recent preview alongside each count, never simulated activity.
  const previewMatches = {
    right_now: readWallFeedFilters({ type: "right_now" }).match,
    ...Object.fromEntries(topics.map(topic => [topic, readWallFeedFilters({ topic }).match])),
    ...Object.fromEntries(categories.map((category) => [category, category === "offering"
      ? { $and: [readWallFeedFilters({ type: category }).match, { $nor: [sellMatch] }] }
      : readWallFeedFilters({ type: category }).match])),
  };
  for (const [key, match] of Object.entries(previewMatches)) {
    facets[`preview_${key}`] = [
      { $match: match }, { $sort: { publishedAt: -1, createdAt: -1, _id: -1 } },
      // Pick the latest note per author before limiting the avatar stack.
      // Three notes from one person must not hide the other active authors.
      { $group: { _id: "$author", note: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$note" } },
      { $sort: { publishedAt: -1, createdAt: -1, _id: -1 } }, { $limit: 3 },
      { $lookup: { from: "users", localField: "author", foreignField: "_id", as: "person" } },
      { $project: { _id: 0, text: { $cond: [
        { $gt: [{ $strLenCP: { $trim: { input: { $ifNull: ["$text", ""] } } } }, 0] }, "$text",
        { $ifNull: [{ $arrayElemAt: [{ $map: { input: { $filter: { input: { $ifNull: ["$media", []] }, as: "media", cond: { $eq: ["$$media.type", "audio"] } } }, as: "audio", in: "$$audio.transcript" } }, 0] }, ""] },
      ] }, author: { $arrayElemAt: ["$person", 0] } } },
      { $project: { text: 1, "author._id": 1, "author.name": 1, "author.avatar": 1 } },
    ];
  }
  facets.right_now = [{ $match: previewMatches.right_now }, { $count: "count" }];
  const [result = {}] = await FeedPost.aggregate([
    { $match: { status: "published", visibility: "public", ...publicWallModerationFilter, deletedAt: null, resolvedAt: null, $expr: wallActiveExpression(), author: { $nin: blockedIds }, "hiddenBy.user": { $ne: req.user._id }, ...options.match } },
    { $facet: facets },
  ]);
  const counts = Object.fromEntries([...categories, "right_now"].map((category) => [category, result[category]?.[0]?.count || 0]));
  const topicCounts = Object.fromEntries(topics.map((topic) => [topic, result[`topic_${topic}`]?.[0]?.count || 0]));
  return sendResponse(res, 200, "Wall need counts fetched", { counts, topicCounts, previews: Object.fromEntries(Object.keys(previewMatches).map((key) => [key, result[`preview_${key}`] || []])), location: String(req.query.location || req.query.near || "").trim().slice(0, 120) });
});

export const listFeedPosts = asyncHandler(async (req, res) => {
  const { page, limit } = pageOptions(req);
  const blocks = await UserBlock.find({ $or: [{ blocker: req.user._id }, { blocked: req.user._id }] }).select("blocker blocked").lean();
  const blockedAuthorIds = blocks.map((block) => String(block.blocker) === String(req.user._id) ? block.blocked : block.blocker);
  const options = readWallFeedFilters(req.query);
  const legacy = feedFilterQuery({ filter: req.query.filter || req.query.context });
  const filter = {
    status: "published",
    deletedAt: null,
    author: { $nin: blockedAuthorIds },
    "hiddenBy.user": { $ne: req.user._id },
    ...legacy,
    ...options.match,
  };
  const [result] = await FeedPost.aggregate(wallFeedPipeline(filter, options, blockedAuthorIds, page, limit)).allowDiskUse(true);
  const rows = result?.items || [];
  const total = result?.total?.[0]?.count || 0;
  const items = rows.length ? await FeedPost.find({ _id: { $in: rows.map((row) => row._id) }, visibility: "public", ...publicWallModerationFilter })
    .populate([
      { path: "author", select: "name username avatar isVerified" },
      { path: "comments.user", select: "name username avatar isVerified" },
      { path: "reactions.user", select: "name username avatar isVerified" },
    ]).lean() : [];
  await attachSavedCommentState(items, req.user?._id);
  await attachEntityMetadata(items, req.user || null);
  const byId = new Map(items.map((item) => [String(item._id), item]));
  const feed = rows.flatMap((row) => {
    const post = byId.get(String(row._id));
    if (!post) return [];
    const activity = row.__activity;
    return [serializePostFeedItem(post, req.user, activity.shareId ? {
      feedId: `share-${activity.shareId}`,
      shareId: String(activity.shareId),
      feedCreatedAt: activity.createdAt,
      shareCaption: activity.caption || "",
      sharedBy: authorPayload(row.__sharer),
    } : {})];
  });
  // Recent is chronological, including after a reload. Recommendation ranking
  // must not replace the database order with older posts or shares.
  const personalized = options.sort === "recent"
    ? { items: feed, recommendation: null }
    : await postControllerTestUtils.personalizeCandidates({ exposureLimit: limit, items: feed, req, surface: "WALL" });
  return sendResponse(res, 200, "Feed posts fetched", {
    items: options.sort === "recent" ? personalized.items : preserveWallTrustOrder(personalized.items, rows),
    recommendation: personalized.recommendation,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

export const getFeedPost = asyncHandler(async (req, res) => {
  const post = await findPublishedPost(req.params.id, req.user);
  const authorId = post.author?._id || post.author;
  const blocked = await UserBlock.exists({ $or: [{ blocker: req.user._id, blocked: authorId }, { blocker: authorId, blocked: req.user._id }] });
  if (blocked || post.hiddenBy.some((item) => String(item.user) === String(req.user._id))) {
    throw new ApiError(404, "Post not found");
  }
  await populatePostForResponse(post);
  await attachSavedCommentState(post, req.user?._id);
  await attachEntityMetadata(post, req.user || null);
  return sendResponse(res, 200, "Feed post fetched", { post: serializePost(post, req.user) });
});

export const markFeedPostViewed = asyncHandler(async (req, res) => {
  const post = await findPublishedPost(req.params.id, req.user);
  const authorId = post.author?._id || post.author;
  const viewerId = req.user._id;
  const currentCount = wallViewCount(post);

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
    { $push: { views: { user: viewerId, actorAccountType: req.user.accountType, viewedAt: new Date() } }, ...(req.user.accountType === "TEST" ? {} : { $inc: { viewCount: 1 } }) },
    { new: true, runValidators: true, select: "viewCount views author" }
  ).lean();
  if (updated) await trackPostEvent(req, "CONTENT_VIEW", post._id, { source: req.body.source || "home" });

  const countedPost = updated || await FeedPost.findById(post._id).select("viewCount views author").lean() || post;
  return sendResponse(res, 200, updated ? "Post view recorded" : "Post view already recorded", {
    postId: String(post._id),
    viewCount: wallViewCount(countedPost),
    viewed: Boolean(updated),
  });
});

export const listMyPosts = asyncHandler(async (req, res) => {
  const { page, limit } = pageOptions(req);
  const requestedStatus = String(req.query.status || "published").toLowerCase();
  const status = ["draft", "published", "archived"].includes(requestedStatus) ? requestedStatus : "published";
  const [items, total] = await Promise.all([
    FeedPost.find({ author: req.user._id, status, deletedAt: null })
      .sort(status === "draft" ? { updatedAt: -1 } : status === "archived" ? { archivedAt: -1, updatedAt: -1 } : { publishedAt: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate([
        { path: "author", select: "name username avatar isVerified" },
        { path: "comments.user", select: "name username avatar isVerified" },
        { path: "reactions.user", select: "name username avatar isVerified" },
      ])
      .lean(),
    FeedPost.countDocuments({ author: req.user._id, status, deletedAt: null }),
  ]);

  await attachSavedCommentState(items, req.user?._id);
  await attachEntityMetadata(items, req.user || null);
  return sendResponse(res, 200, status === "draft" ? "Draft posts fetched" : status === "archived" ? "Archived posts fetched" : "Creator posts fetched", {
    items: items.map((item) => serializePost(item, req.user)),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

export const createFeedPost = asyncHandler(async (req, res) => {
  const files = req.files || {};
  let release;
  let published = false;
  try {
    const text = validateWallCreation(req.body, files, req.user);
    req.wallCreationKey = creationKey(req);
    req.wallFingerprint = await wallFingerprint(req);
    const previous = await FeedPost.findOne({ author: req.user._id, creationKey: req.wallCreationKey }).select("+moderationEvidence");
    if (previous) {
      if (previous.creationFingerprint !== req.wallFingerprint) throw new ApiError(409, "This request key was used for a different note");
      if (previous.deletedAt || previous.status !== "published") throw new ApiError(409, "This note was already published and later removed");
      if (previous.moderationStatus === "PENDING_REVIEW") await queueWallCopyReview(previous, previous.moderationEvidence);
      await populatePostForResponse(previous);
      return sendResponse(res, 200, "Note already published", { post: serializePost(previous, req.user) });
    }
    if (files.voice?.[0]) req.wallPreparedVoice = await prepareWallVoiceTranscript({ file: files.voice[0], transcript: cleanString(req.body.voiceTranscript, POST_TEXT_MAX_LENGTH), transcriptLanguage: normalizeVoiceLanguageCode(req.body.voiceTranscriptLanguage) });
    const content = [text, req.wallPreparedVoice?.transcript || ""].filter(Boolean).join(" ");
    validateWallPublishingText(content, req.user);
    release = await reserveWallCreation(req.user._id, content, req.wallCreationKey, new Date(), { user: req.user, postType: req.body.postType });
    req.wallCopyEvidence = await findRecentWallCopy(req.user._id, content);
    assertNotExactWallCopy(req.wallCopyEvidence);
    const post = await createPostRecord({ imageFiles: files.media || [], req, status: "published", voiceFile: files.voice?.[0] || null });
    published = true;
    if (req.wallCopyEvidence) await queueWallCopyReview(post, req.wallCopyEvidence);
    await recordChecklistEvent(req.user._id, "createdFirstPost").catch(() => {});
    await attachEntityMetadata(post, req.user || null);
    return sendResponse(res, req.wallCopyEvidence ? 202 : 201, req.wallCopyEvidence ? "Note submitted for review" : "Post published", { post: serializePost(post, req.user) });
  } finally {
    if (release && !published) {
      const saved = await FeedPost.exists({ author: req.user._id, creationKey: req.wallCreationKey });
      if (!saved) await release();
    }
    await cleanupWallFiles(files);
  }
});

export const createDraftPost = asyncHandler(async (req, res) => {
  const post = await createPostRecord({ imageFiles: req.files || [], req, status: "draft" });
  await attachEntityMetadata(post, req.user || null);
  return sendResponse(res, 201, "Draft saved", { post: serializePost(post, req.user) });
});

export const setPostResolution = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid post ID");
  if (typeof req.body?.solved !== "boolean") throw new ApiError(400, "Solved must be true or false");
  // Update just the resolution field, so simultaneous replies and reactions stay intact.
  const post = await FeedPost.findOneAndUpdate(
    wallResolutionTarget(req.params.id, req.user._id),
    { $set: { resolvedAt: req.body.solved ? new Date() : null } },
    { new: true, runValidators: true },
  );
  if (!post) throw new ApiError(404, "Request post not found or unavailable");
  await populatePostForResponse(post);
  await attachSavedCommentState([post], req.user._id);
  await attachEntityMetadata(post, req.user || null);
  return sendResponse(res, 200, req.body.solved ? "Request marked as Solved" : "Request reopened", { post: serializePost(post, req.user) });
});

export const bumpFeedPost = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid post ID");
  const now = new Date();
  const current = await FeedPost.findOne({ _id: req.params.id, author: req.user._id, status: "published", deletedAt: null }).lean();
  if (current?.bumpCount >= 3) throw new ApiError(409, "Bumped 3 times \u2014 post it fresh if it's still on", "WALL_BUMP_LIMIT");
  if (current?.bumpedAt && now - new Date(current.bumpedAt) < 7 * 86400000) {
    const days = Math.ceil((7 * 86400000 - (now - new Date(current.bumpedAt))) / 86400000);
    throw new ApiError(409, `You can bump again in ${days} days`, "WALL_BUMP_COOLDOWN");
  }
  // Eligibility, limits and the write share one predicate to reject concurrent renewals.
  const post = await FeedPost.findOneAndUpdate({
    _id: req.params.id, author: req.user._id, status: "published", deletedAt: null,
    visibility: "public", ...publicWallModerationFilter,
    $expr: { $and: [
      wallActiveExpression(now), wallBumpExpression(now),
      { $lt: [{ $ifNull: ["$bumpCount", 0] }, 3] },
      { $or: [{ $eq: [{ $ifNull: ["$bumpedAt", null] }, null] }, { $lte: ["$bumpedAt", new Date(now.getTime() - 7 * 86400000)] }] },
    ] },
  }, { $set: { bumpedAt: now, outdatedVoters: [] }, $inc: { bumpCount: 1 } }, { new: true, runValidators: true });
  if (!post) throw new ApiError(409, "This note is not eligible to keep or bump. Notes can be bumped at most 3 times, once per 7 days, before expiry.");
  await populatePostForResponse(post);
  await attachSavedCommentState(post, req.user._id);
  await attachEntityMetadata(post, req.user || null);
  return sendResponse(res, 200, "Bumped — back in front of people nearby", { post: serializePost(post, req.user) });
});

const updateFeedPostInternal = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new ApiError(400, "Invalid post ID");
  }

  const post = await FeedPost.findOne({ _id: req.params.id, author: req.user._id, deletedAt: null }).select("+noteVersions");
  if (!post) {
    throw new ApiError(404, "Post not found");
  }

  if (post.status !== "draft") assertWallEditAllowed(post);
  if (req.body.editVersion != null && Number(req.body.editVersion) !== (post.__v || 0)) throw new ApiError(409, "This note changed. Reopen it before saving.", "WALL_EDIT_CONFLICT");
  const previousPost = post.toObject();
  if (req.body.text != null && (typeof req.body.text !== "string" || req.body.text.trim().length > POST_TEXT_MAX_LENGTH)) throw new ApiError(400, "Notes must contain at most 2,000 characters");
  const text = Object.hasOwn(req.body, "text") ? cleanString(req.body.text, POST_TEXT_MAX_LENGTH) : post.text;
  const context = Object.hasOwn(req.body, "context") ? readContext(req.body.context) : post.context;
  const entityRefs = Object.hasOwn(req.body, "entityRefs") ? await validateEntityRefs(req.body.entityRefs) : post.entityRefs;
  const location = Object.hasOwn(req.body, "location") ? readLocation(req.body.location) : post.location;

  if (post.status === "published" && !text && !(post.media || []).some(item => item.type === "audio")) {
    throw new ApiError(400, "Post text is required");
  }

  if (Object.hasOwn(req.body, "rightNow")) post.rightNow = req.body.rightNow === true || req.body.rightNow === "true";
  if (Object.hasOwn(req.body, "postType")) post.postType = req.body.postType;
  if (Object.hasOwn(req.body, "topic")) post.topic = req.body.topic;
  post.text = text;
  post.context = context;
  post.entityRefs = entityRefs;
  post.location = location;
  if (Object.hasOwn(req.body, "countryCode")) post.countryCode = cleanString(req.body.countryCode, 2).toUpperCase();
  else if (Object.hasOwn(req.body, "location")) post.countryCode = "";
  Object.assign(post, readWallPrice(post.postType === "Buy & Sell" ? (Object.hasOwn(req.body, "price") ? req.body.price : post.price) : null, post.postType, location, post.countryCode));

  if (req.body.retainedMedia != null || Object.keys(req.files || {}).length) {
    let ids;
    try { ids = JSON.parse(req.body.retainedMedia || "[]"); } catch { throw new ApiError(400, "Invalid retained media"); }
    if (!Array.isArray(ids) || ids.some(id => typeof id !== "string")) throw new ApiError(400, "Invalid retained media");
    const originalMedia = previousPost.media || [];
    if (ids.some(id => !originalMedia.some(item => String(item._id || item.id || item.assetId) === id))) throw new ApiError(400, "Media must belong to this note");
    const retained = originalMedia.filter(item => ids.includes(String(item._id || item.id || item.assetId)));
    if (retained.filter(item => item.type === "image").length + (req.files?.media?.length || 0) > 3 || retained.filter(item => item.type === "audio").length + (req.files?.voice?.length || 0) > 1) throw new ApiError(400, "Attach at most three photos and one voice note");
    const added = req.files?.media?.length || req.files?.voice?.length ? await uploadPostMedia({ imageFiles: req.files?.media || [], post, req, userId: req.user._id, voiceFile: req.files?.voice?.[0] || null }) : [];
    req.wallNewEditMedia = added;
    post.media = [...retained, ...added];
  }
  let release;
  const publishing = post.status === "draft" && req.body.publish === "true";
  const content = [text, ...(post.media || []).filter(item => item.type === "audio").map(item => item.transcript || "")].filter(Boolean).join(" ");
  let copyEvidence;
  if (post.status === "published" || publishing) {
    const media = post.media || [];
    validateWallCreation({ ...req.body, text, postType: post.postType, location: post.location, countryCode: post.countryCode, price: post.price, rightNow: post.rightNow, voiceTranscript: media.filter(item => item.type === "audio").map(item => item.transcript || "").join(" ") }, { media: media.filter(item => item.type === "image"), voice: media.filter(item => item.type === "audio") }, req.user);
    if (publishing || previousPost.text !== text || req.body.retainedMedia != null || req.files?.voice?.length) copyEvidence = await findRecentWallCopy(req.user._id, content);
    assertNotExactWallCopy(copyEvidence);
    if (copyEvidence) { post.moderationStatus = "PENDING_REVIEW"; post.moderationReason = "RECENT_COPY"; post.moderationEvidence = copyEvidence; post.visibility = "private"; }
  }
  if (publishing) {
    const media = post.media || [];
    if (media.some((item) => item.type === "audio" && item.duration > 30)) throw new ApiError(400, "Wall voice notes must be 30 seconds or shorter");
    post.creationKey = post.creationKey || creationKey(req);
    await post.validate();
    release = await reserveWallCreation(req.user._id, content, post.creationKey, new Date(), { user: req.user, postType: post.postType });
    post.status = "published";
    post.visibility = copyEvidence ? "private" : "public";
    post.publishedAt = new Date();
  }

  if (previousPost.status === "published" && (previousPost.text !== text || previousPost.postType !== post.postType)) {
    await post.validate();
    await registerWallEdit(previousPost, content, new Date(), { user: req.user, postType: post.postType });
  }

  if (previousPost.status === "published") {
    assertWallEditAllowed(previousPost);
    const before = wallNoteVersion(previousPost), after = wallNoteVersion(post.toObject());
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      post.editedAt = new Date();
      post.noteVersions.push( { ...before, replacedAt: post.editedAt, editedBy: req.user._id, version: previousPost.__v || 0 });
    }
    post.$where = { __v: previousPost.__v || 0, status: "published", deletedAt: null, resolvedAt: null, moderationHiddenAt: null, moderationStatus: { $nin: ["PENDING_REVIEW", "REJECTED"] }, $expr: { $gt: [{ $add: [{ $ifNull: ["$publishedAt", "$createdAt"] }, 900000] }, "$$NOW"] } };
    post.increment();
  }
  try { await post.save(); req.wallEditSaved = true; } catch (error) { if (release) await release(); throw error; }
  if (copyEvidence) await queueWallCopyReview(post, copyEvidence);
  if (post.status === "published") await recordChecklistEvent(req.user._id, "createdFirstPost");
  await populatePostForResponse(post);
  await attachEntityMetadata(post, req.user || null);
  return sendResponse(res, 200, post.status === "published" ? "Post updated" : "Draft updated", { post: serializePost(post, req.user) });
};
export const updateFeedPost = asyncHandler(async (req, res) => {
  try { return await updateFeedPostInternal(req, res); }
  catch (error) {
    if (["VersionError", "DocumentNotFoundError"].includes(error.name)) throw new ApiError(409, "This note changed or its edit window ended. Reopen the note.", "WALL_EDIT_CONFLICT");
    throw error;
  }
  finally {
    await cleanupWallFiles(req.files || {});
    if (!req.wallEditSaved && req.wallNewEditMedia?.length) await deleteFeedPostMedia(req.wallNewEditMedia);
  }
});

export const updatePostReaction = asyncHandler(async (req, res) => {
  const post = await findPublishedPost(req.params.id, req.user);
  const reaction = readReaction(req.body.reaction);
  const userId = String(req.user._id);
  const existing = post.reactions.find((item) => String(item.user) === userId);

  if (!reaction) {
    post.reactions = post.reactions.filter((item) => String(item.user) !== userId);
  } else if (existing) {
    existing.reaction = reaction;
  } else {
    post.reactions.push({ user: req.user._id, actorAccountType: req.user.accountType, reaction });
  }

  post.supportCount = post.reactions.filter((item) => item.actorAccountType !== "TEST").length;
  await post.save();
  if (reaction) await trackPostEvent(req, "REACTION", post._id, { metadata: { reaction } });
  await populatePostForResponse(post);
  await attachSavedCommentState(post, req.user?._id);
  await attachEntityMetadata(post, req.user || null);
  return sendResponse(res, 200, reaction ? "Reaction saved" : "Reaction removed", { post: serializePost(post, req.user) });
});

export const togglePostSave = asyncHandler(async (req, res) => {
  const post = await findPublishedPost(req.params.id, req.user);
  const userId = String(req.user._id);
  const existing = post.saves.find((item) => String(item.user) === userId);

  if (existing) {
    post.saves = post.saves.filter((item) => String(item.user) !== userId);
  } else {
    post.saves.push({ user: req.user._id, actorAccountType: req.user.accountType });
  }

  post.saveCount = post.saves.filter((item) => item.actorAccountType !== "TEST").length;
  await post.save();
  if (!existing) await trackPostEvent(req, "SAVE", post._id);
  await populatePostForResponse(post);
  await attachSavedCommentState(post, req.user?._id);
  await attachEntityMetadata(post, req.user || null);
  return sendResponse(res, 200, existing ? "Post removed from Saved" : "Post saved", { post: serializePost(post, req.user) });
});

export const togglePostShare = asyncHandler(async (req, res) => {
  const post = await findPublishedPost(req.params.id, req.user);
  const userId = String(req.user._id);
  if (String(post.author?._id || post.author) === userId) throw new ApiError(409, "It's already on your profile");
  const existing = post.shares.find((item) => String(item.user) === userId);

  if (existing) {
    post.shares = post.shares.filter((item) => String(item.user) !== userId);
  } else {
    post.shares.push({ user: req.user._id, actorAccountType: req.user.accountType, caption: cleanString(req.body.caption, 500) });
  }

  post.shareCount = post.shares.length;
  await post.save();
  await syncRepost({ enabled: !existing, kind: "note", originalAuthor: post.author?._id || post.author, targetId: post._id, targetModel: "FeedPost", user: req.user._id });
  if (!existing) await trackPostEvent(req, "SHARE", post._id);
  await populatePostForResponse(post);
  await attachSavedCommentState(post, req.user?._id);
  await post.populate({ path: "shares.user", select: "name username avatar isVerified role status" });
  await attachEntityMetadata(post, req.user || null);
  return sendResponse(res, 200, existing ? "Post removed from your profile" : "Post shared to your profile", { post: serializePost(post, req.user) });
});

export const hideFeedPost = asyncHandler(async (req, res) => {
  const post = await findPublishedPost(req.params.id, req.user);
  const userId = String(req.user._id);
  if (!post.hiddenBy.some((item) => String(item.user) === userId)) {
    post.hiddenBy.push({ user: req.user._id, reason: cleanString(req.body.reason || "NOT_USEFUL", 80) || "NOT_USEFUL" });
    await post.save();
  }
  return sendResponse(res, 200, "Post hidden from your feed", { postId: String(post._id), hidden: true });
});

export const reportFeedPost = asyncHandler(async (req, res) => {
  const post = await findPublishedPost(req.params.id, req.user);
  if (String(post.author) === String(req.user._id)) throw new ApiError(400, "You cannot report your own post");
  const reason = cleanString(req.body.reason || "OTHER", 80).toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_");
    const allowed = new Set(["SPAM", "FALSE_INFORMATION", "DEFAMATION", "HARASSMENT", "HATE", "NUDITY", "SEXUAL_CONTENT", "VIOLENCE", "SELF_HARM", "ILLEGAL_CONTENT", "COPYRIGHT", "SCAM", "IMPERSONATION", "CHILD_SAFETY", "OTHER"]);
  if (!allowed.has(reason)) throw new ApiError(400, "Select a valid report reason");
  try {
    const report = await MessageReport.create({
      reporter: req.user._id,
      reportedUser: post.author,
      scope: "FEED_POST",
      qualifiesForWallAutoHide: await wallReporterQualification(req.user._id),
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
  const post = await findPublishedPost(req.params.id, req.user);
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
  const post = await findPublishedPost(req.params.id, req.user);
  const parentCommentId = req.body.parentCommentId || null;
  if (parentCommentId && !post.comments.some(comment => String(comment._id) === String(parentCommentId) && !comment.deletedAt)) {
    throw new ApiError(400, "Reply target is no longer available on this note");
  }
  const hasVoiceFile = Boolean(req.file?.buffer?.length);
  const text = String(req.body.text || "").trim();
  if ((!text && !hasVoiceFile) || text.length > 500) throw new ApiError(400, hasVoiceFile ? "Voice comment text must not exceed 500 characters" : "Comment must contain 1 to 500 characters");
  const audio = hasVoiceFile ? await uploadMessageVoice({ buffer: req.file.buffer, folder: `onlyme/posts/comments/${post._id}`, maxDurationSeconds: 30, purpose: "voice_comment", senderId: req.user._id }) : null;
  if (audio) {
    try { audio.waveform = JSON.parse(req.body.waveform || "[]").map(Number).filter(Number.isFinite).slice(0, 100); } catch { audio.waveform = []; }
  }
  post.comments.push({ user: req.user._id, actorAccountType: req.user.accountType, parentCommentId, text: text || "Voice comment", audio: audio || undefined });
  post.commentCount = post.comments.filter((comment) => !comment.deletedAt && comment.actorAccountType !== "TEST").length;
  await post.save();
  await trackPostEvent(req, "COMMENT", post._id);
  await populatePostForResponse(post);
  await attachSavedCommentState(post, req.user?._id);
  await attachEntityMetadata(post, req.user || null);
  return sendResponse(res, 201, "Comment saved", { post: serializePost(post, req.user) });
});

export const updatePostCommentReaction = asyncHandler(async (req, res) => {
  const post = await findPublishedPost(req.params.id, req.user);
  const comment = post.comments.find(item => String(item._id) === req.params.commentId && !item.deletedAt);
  if (!comment) throw new ApiError(404, "Reply not found");
  const reaction = req.body.reaction;
  if (typeof reaction !== "string" || (reaction && !POST_REACTIONS.includes(reaction))) throw new ApiError(400, "Invalid reaction");
  comment.reactions = (comment.reactions || []).filter(item => String(item.user) !== String(req.user._id));
  if (reaction) comment.reactions.push({ user: req.user._id, actorAccountType: req.user.accountType, reaction });
  await post.save();
  await populatePostForResponse(post);
  await attachSavedCommentState(post, req.user?._id);
  await attachEntityMetadata(post, req.user || null);
  return sendResponse(res, 200, "Reply reaction saved", { post: serializePost(post, req.user) });
});

export const deletePostComment = asyncHandler(async (req, res) => {
  const post = await findPublishedPost(req.params.id, req.user);
  const comment = post.comments.find((item) => String(item._id) === req.params.commentId && !item.deletedAt);
  if (!comment) throw new ApiError(404, "Comment not found");
  if (String(comment.user?._id || comment.user) !== String(req.user._id)) throw new ApiError(403, "You can only delete your own comment");

  const removedIds = new Set([String(comment._id)]);
  let foundReply = true;
  while (foundReply) {
    foundReply = false;
    post.comments.forEach((item) => {
      if (!item.deletedAt && item.parentCommentId && removedIds.has(String(item.parentCommentId)) && !removedIds.has(String(item._id))) {
        removedIds.add(String(item._id));
        foundReply = true;
      }
    });
  }
  const deletedAt = new Date();
  post.comments.forEach((item) => { if (removedIds.has(String(item._id))) item.deletedAt = deletedAt; });
  post.commentCount = post.comments.filter((item) => !item.deletedAt && item.actorAccountType !== "TEST").length;
  await post.save();
  await populatePostForResponse(post);
  await attachSavedCommentState(post, req.user?._id);
  await attachEntityMetadata(post, req.user || null);
  return sendResponse(res, 200, "Comment deleted", { post: serializePost(post, req.user) });
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

export const archiveFeedPost = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid post ID");
  const post = await FeedPost.findOne({ _id: req.params.id, author: req.user._id, deletedAt: null });
  if (!post) throw new ApiError(404, "Post not found");
  post.status = "archived";
  post.archivedAt = new Date();
  await post.save();
  return sendResponse(res, 200, "Post archived", { postId: String(post._id), archived: true });
});

export const restoreFeedPost = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid post ID");
  const post = await FeedPost.findOneAndUpdate({ _id: req.params.id, author: req.user._id, status: "archived", moderationStatus: { $nin: ["PENDING_REVIEW", "REJECTED"] }, moderationHiddenAt: null, deletedAt: null }, { $set: { status: "published" }, $unset: { archivedAt: 1 } }, { new: true });
  if (!post) throw new ApiError(404, "Archived post not found");
  return sendResponse(res, 200, "Post restored", { postId: String(post._id), restored: true });
});
