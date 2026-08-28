import mongoose from "mongoose";
import FeedPost from "../models/FeedPost.js";
import PremiumMembership from "../models/PremiumMembership.js";
import Publication from "../models/Publication.js";
import PublicationPreference from "../models/PublicationPreference.js";
import SeenEngagement from "../models/SeenEngagement.js";
import UserBlock from "../models/UserBlock.js";
import WallEngagement from "../models/WallEngagement.js";
import WallPost from "../models/WallPost.js";
import WallShareEngagement from "../models/WallShareEngagement.js";
import WorldEntitlement from "../models/WorldEntitlement.js";
import { serializePublication } from "../services/publicationAccessService.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { serializePost } from "./postController.js";
import { engagementForWallPost, engagementForWallShare, serializeWallPost } from "./wallController.js";

const SAVED_CATEGORIES = ["places", "journeys", "experiences", "people", "posts", "books", "comments"];
const ZERO_COUNTS = Object.freeze({ places: 0, journeys: 0, experiences: 0, people: 0, posts: 0, books: 0, comments: 0 });
const WORLD_KINDS = ["WORLD", "PREMIUM_WORLD"];
const ACTIVE_MEMBERSHIP_STATUSES = ["ACTIVE", "CANCEL_AT_PERIOD_END"];
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

function readPage(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(query.limit, 10) || DEFAULT_LIMIT));
  return { page, limit, offset: (page - 1) * limit };
}

function emptyPage(paging) {
  return {
    items: [],
    pagination: { page: paging.page, limit: paging.limit, total: 0, pages: 0, hasMore: false },
  };
}

async function visibilityContext(userId) {
  const [blocks, preferences] = await Promise.all([
    UserBlock.find({ $or: [{ blocker: userId }, { blocked: userId }] }).select("blocker blocked").lean(),
    PublicationPreference.find({ user: userId, type: { $in: ["HIDDEN_SEEN", "MUTED_CREATOR"] } }).select("publication creator type").lean(),
  ]);
  const blockedCreatorIds = blocks.map((block) => String(block.blocker) === String(userId) ? block.blocked : block.blocker);
  const mutedCreatorIds = preferences.filter((item) => item.type === "MUTED_CREATOR" && item.creator).map((item) => item.creator);
  const hiddenPublicationIds = preferences.filter((item) => item.type === "HIDDEN_SEEN" && item.publication).map((item) => item.publication);
  return {
    blockedCreatorIds,
    hiddenPublicationIds,
    publicationCreatorExclusions: [...blockedCreatorIds, ...mutedCreatorIds],
  };
}

function visiblePublicationFilter(context, kinds = []) {
  return {
    status: "PUBLISHED",
    publishedSnapshot: { $exists: true },
    ...(kinds.length ? { kind: { $in: kinds } } : {}),
    ...(context.publicationCreatorExclusions.length ? { creator: { $nin: context.publicationCreatorExclusions } } : {}),
    ...(context.hiddenPublicationIds.length ? { _id: { $nin: context.hiddenPublicationIds } } : {}),
  };
}

async function countVisibleSavedPublications(userId, context) {
  const match = {
    user: new mongoose.Types.ObjectId(userId),
    type: "SAVE",
  };
  const publicationMatch = {
    "publication.status": "PUBLISHED",
    "publication.publishedSnapshot": { $exists: true },
    ...(context.publicationCreatorExclusions.length ? { "publication.creator": { $nin: context.publicationCreatorExclusions } } : {}),
    ...(context.hiddenPublicationIds.length ? { "publication._id": { $nin: context.hiddenPublicationIds } } : {}),
  };
  const rows = await SeenEngagement.aggregate([
    { $match: match },
    { $lookup: { from: Publication.collection.name, localField: "publication", foreignField: "_id", as: "publication" } },
    { $unwind: "$publication" },
    { $match: publicationMatch },
    { $group: { _id: "$publication.kind", count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [row._id, row.count]));
}

async function countVisibleWallSaves(userId, context) {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const wallMatch = {
    "post.status": "PUBLISHED",
    ...(context.blockedCreatorIds.length ? { "post.creator": { $nin: context.blockedCreatorIds } } : {}),
  };
  const [postRows, shareRows] = await Promise.all([
    WallEngagement.aggregate([
      { $match: { user: userObjectId, type: "SAVE" } },
      { $lookup: { from: WallPost.collection.name, localField: "post", foreignField: "_id", as: "post" } },
      { $unwind: "$post" },
      { $match: wallMatch },
      { $count: "count" },
    ]),
    WallShareEngagement.aggregate([
      { $match: { user: userObjectId, type: "SAVE" } },
      { $lookup: { from: WallEngagement.collection.name, localField: "share", foreignField: "_id", as: "share" } },
      { $unwind: "$share" },
      { $match: { "share.type": "SHARE" } },
      { $lookup: { from: WallPost.collection.name, localField: "share.post", foreignField: "_id", as: "post" } },
      { $unwind: "$post" },
      { $match: wallMatch },
      { $count: "count" },
    ]),
  ]);
  return (postRows[0]?.count || 0) + (shareRows[0]?.count || 0);
}

async function visibleUnlockedPublicationIds(userId, context) {
  const now = new Date();
  const [worlds, memberships] = await Promise.all([
    WorldEntitlement.find({ user: userId, status: "ACTIVE" }).select("publication grantedAt").lean(),
    PremiumMembership.find({ user: userId, status: { $in: ACTIVE_MEMBERSHIP_STATUSES }, currentPeriodEnd: { $gt: now } }).select("premiumPublication currentPeriodStart").lean(),
  ]);
  const unlockedAtByPublication = new Map();
  for (const row of worlds) unlockedAtByPublication.set(String(row.publication), row.grantedAt || row.createdAt);
  for (const row of memberships) unlockedAtByPublication.set(String(row.premiumPublication), row.currentPeriodStart || row.createdAt);
  const ids = [...unlockedAtByPublication.keys()].filter(mongoose.isValidObjectId);
  if (!ids.length) return { ids: new Set(), unlockedAtByPublication: new Map() };
  const visible = await Publication.find({
    _id: { $in: ids },
    ...visiblePublicationFilter(context, WORLD_KINDS),
  }).select("_id").lean();
  const visibleIds = new Set(visible.map((item) => String(item._id)));
  return { ids: visibleIds, unlockedAtByPublication };
}

async function savedOverview(userId) {
  const context = await visibilityContext(userId);
  const [publicationCounts, feedPostCount, wallPostCount, unlocked] = await Promise.all([
    countVisibleSavedPublications(userId, context),
    FeedPost.countDocuments({
      status: "published",
      deletedAt: null,
      "saves.user": userId,
      "hiddenBy.user": { $ne: userId },
      ...(context.blockedCreatorIds.length ? { author: { $nin: context.blockedCreatorIds } } : {}),
    }),
    countVisibleWallSaves(userId, context),
    visibleUnlockedPublicationIds(userId, context),
  ]);
  const savedSeenCount = publicationCounts.get("SEEN") || 0;
  const savedExperienceCount = WORLD_KINDS.reduce((sum, kind) => sum + (publicationCounts.get(kind) || 0), 0);

  return {
    counts: {
      ...ZERO_COUNTS,
      experiences: savedExperienceCount,
      posts: savedSeenCount + feedPostCount + wallPostCount,
    },
    metadata: {
      experiences: { unlockedCount: unlocked.ids.size },
    },
    support: {
      places: false,
      journeys: false,
      experiences: true,
      people: false,
      posts: true,
      books: false,
      comments: false,
    },
  };
}

function savedAtForFeedPost(post, userId) {
  return (post.saves || []).find((item) => String(item.user?._id || item.user) === String(userId))?.createdAt || post.updatedAt || post.createdAt;
}

async function loadSavedPublications({ context, kinds, limit, user, withUnlocked = false }) {
  const saveRows = await SeenEngagement.find({ user: user._id, type: "SAVE" })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .select("publication createdAt")
    .lean();
  const savedAtByPublication = new Map(saveRows.map((row) => [String(row.publication), row.createdAt]));
  const unlocked = withUnlocked ? await visibleUnlockedPublicationIds(user._id, context) : { ids: new Set(), unlockedAtByPublication: new Map() };
  const ids = [...new Set([...savedAtByPublication.keys(), ...unlocked.ids])].filter(mongoose.isValidObjectId);
  if (!ids.length) return [];
  const records = await Publication.find({
    _id: { $in: ids },
    ...visiblePublicationFilter(context, kinds),
  }).populate("creator", "name username avatar isVerified").lean();
  return records
    .map((publication) => {
      const id = String(publication._id);
      const unlockedAt = unlocked.unlockedAtByPublication.get(id) || null;
      const serialized = serializePublication(publication, user, { entitlement: unlocked.ids.has(id) ? "ACTIVE_PREMIUM_MEMBER" : null });
      return serialized ? {
        ...serialized,
        savedAt: savedAtByPublication.get(id) || null,
        unlockedAt,
        viewerSaved: savedAtByPublication.has(id),
        viewerUnlocked: unlocked.ids.has(id),
      } : null;
    })
    .filter(Boolean)
    .sort((left, right) => new Date(right.savedAt || right.unlockedAt || 0) - new Date(left.savedAt || left.unlockedAt || 0));
}

async function listSavedExperiences(user, paging) {
  const context = await visibilityContext(user._id);
  const pageEnd = paging.offset + paging.limit;
  const rows = await loadSavedPublications({ context, kinds: WORLD_KINDS, limit: Math.max(pageEnd + 1, paging.limit + 1), user, withUnlocked: true });
  const items = rows.slice(paging.offset, paging.offset + paging.limit);
  const hasMore = rows.length > pageEnd;
  const total = hasMore ? pageEnd + 1 : rows.length;
  return {
    items,
    pagination: {
      page: paging.page,
      limit: paging.limit,
      total,
      pages: Math.ceil(total / paging.limit),
      hasMore,
    },
  };
}

async function listSavedPostsPage(user, paging) {
  const context = await visibilityContext(user._id);
  const fetchLimit = Math.max(paging.offset + paging.limit, paging.limit);
  const [seenRows, feedPosts, wallSaves, wallShareSaves, totals] = await Promise.all([
    loadSavedPublications({ context, kinds: ["SEEN"], limit: fetchLimit, user }),
    FeedPost.find({
      status: "published",
      deletedAt: null,
      "saves.user": user._id,
      "hiddenBy.user": { $ne: user._id },
      ...(context.blockedCreatorIds.length ? { author: { $nin: context.blockedCreatorIds } } : {}),
    })
      .sort({ "saves.createdAt": -1, publishedAt: -1, createdAt: -1 })
      .limit(fetchLimit)
      .populate([
        { path: "author", select: "name username avatar isVerified" },
        { path: "comments.user", select: "name username avatar isVerified" },
      ])
      .lean(),
    WallEngagement.find({ user: user._id, type: "SAVE" })
      .sort({ createdAt: -1, _id: -1 })
      .limit(fetchLimit)
      .select("post createdAt")
      .populate({ path: "post", match: { status: "PUBLISHED", ...(context.blockedCreatorIds.length ? { creator: { $nin: context.blockedCreatorIds } } : {}) }, populate: { path: "creator", select: "name username avatar isVerified" } })
      .lean(),
    WallShareEngagement.find({ user: user._id, type: "SAVE" })
      .sort({ createdAt: -1, _id: -1 })
      .limit(fetchLimit)
      .populate({ path: "share", match: { type: "SHARE" }, populate: [{ path: "post", match: { status: "PUBLISHED", ...(context.blockedCreatorIds.length ? { creator: { $nin: context.blockedCreatorIds } } : {}) }, populate: { path: "creator", select: "name username avatar isVerified" } }, { path: "user", select: "name username avatar isVerified" }] })
      .lean(),
    savedOverview(user._id),
  ]);

  const feedEntries = feedPosts.map((post) => ({
    id: `feed-post:${post._id}`,
    type: "feedPost",
    savedAt: savedAtForFeedPost(post, user._id),
    item: serializePost(post, user),
  }));
  const seenEntries = seenRows.map((seen) => ({ id: `seen:${seen.id}`, type: "seen", savedAt: seen.savedAt, item: seen }));
  const wallEntries = await Promise.all(wallSaves
    .filter((save) => save.post)
    .map(async (save) => ({
      id: `wall-post:${save.post._id}`,
      type: "wallPost",
      savedAt: save.createdAt,
      item: serializeWallPost(save.post, await engagementForWallPost(save.post._id, user._id)),
    })));
  const shareEntries = await Promise.all(wallShareSaves
    .filter((save) => save.share?.post && save.share?.user)
    .map(async (save) => {
      const share = save.share;
      const originalEngagement = await engagementForWallPost(share.post._id, user._id);
      return {
        id: `wall-share:${share._id}`,
        type: "wallShare",
        savedAt: save.createdAt,
        item: serializeWallPost(share.post, {
          ...(await engagementForWallShare(share._id, user._id)),
          shareCount: originalEngagement.shareCount,
          viewerShared: originalEngagement.viewerShared,
        }, {
          feedId: `share-${share._id}`,
          shareId: share._id,
          feedCreatedAt: share.createdAt,
          shareCaption: share.text || "",
          sharedBy: { id: share.user._id, name: share.user.name, username: share.user.username, avatar: share.user.avatar || "", verified: Boolean(share.user.isVerified) },
        }),
      };
    }));
  const rows = [...feedEntries, ...seenEntries, ...wallEntries, ...shareEntries]
    .sort((left, right) => new Date(right.savedAt || 0) - new Date(left.savedAt || 0));
  const items = rows.slice(paging.offset, paging.offset + paging.limit);
  const total = totals.counts.posts;
  return {
    items,
    seens: items.filter((entry) => entry.type === "seen").map((entry) => entry.item),
    wallPosts: items.filter((entry) => ["feedPost", "wallPost", "wallShare"].includes(entry.type)).map((entry) => entry.item),
    pagination: { page: paging.page, limit: paging.limit, total, pages: Math.ceil(total / paging.limit), hasMore: paging.offset + items.length < total },
  };
}

export const getSavedOverview = asyncHandler(async (req, res) => {
  return sendResponse(res, 200, "Saved overview fetched", await savedOverview(req.user._id));
});

export const listSavedCategory = asyncHandler(async (req, res) => {
  const category = String(req.params.category || "").toLowerCase();
  if (!SAVED_CATEGORIES.includes(category)) throw new ApiError(400, "Unsupported Saved category");
  const paging = readPage(req.query);
  if (category === "posts") return sendResponse(res, 200, "Saved posts fetched", await listSavedPostsPage(req.user, paging));
  if (category === "experiences") return sendResponse(res, 200, "Saved experiences fetched", await listSavedExperiences(req.user, paging));
  return sendResponse(res, 200, `Saved ${category} fetched`, emptyPage(paging));
});

export const listSavedContent = asyncHandler(async (req, res) => {
  const paging = { page: 1, limit: 100, offset: 0 };
  const posts = await listSavedPostsPage(req.user, paging);
  return sendResponse(res, 200, "Saved content fetched", {
    seens: posts.seens,
    wallPosts: posts.wallPosts,
  });
});

export const savedControllerTestUtils = {
  SAVED_CATEGORIES,
  readPage,
};
