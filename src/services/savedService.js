import mongoose from "mongoose";
import Content from "../models/Content.js";
import FeedPost from "../models/FeedPost.js";
import OrbitDream from "../models/OrbitDream.js";
import Place from "../models/Place.js";
import PremiumMembership from "../models/PremiumMembership.js";
import Publication from "../models/Publication.js";
import SavedItem from "../models/SavedItem.js";
import SeenEngagement from "../models/SeenEngagement.js";
import WallEngagement from "../models/WallEngagement.js";
import WallShareEngagement from "../models/WallShareEngagement.js";
import WorldEntitlement from "../models/WorldEntitlement.js";
import { serializePublication } from "./publicationAccessService.js";
import ApiError from "../utils/ApiError.js";

const PUBLIC_CONTENT_STATUSES = ["PUBLISHED", "published"];
const ACTIVE_MEMBERSHIP_STATUSES = ["ACTIVE", "CANCEL_AT_PERIOD_END"];
const WORLD_KINDS = ["WORLD", "PREMIUM_WORLD"];

function requireObjectId(id, label) {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(400, `Invalid ${label}`);
}

function cleanText(value, maxLength = 220) {
  return String(value || "").replace(/\s+/gu, " ").trim().slice(0, maxLength);
}

function authorPayload(user = {}) {
  return {
    id: String(user?._id || user?.id || ""),
    name: user?.name || user?.username || "Creator",
    username: user?.username || "",
    avatar: user?.avatar || "",
    verified: Boolean(user?.isVerified || user?.verified),
  };
}

function contentMedia(content = {}) {
  const media = content.thumbnail || (content.media || []).find((item) => item.isPrimary) || (content.media || [])[0] || (content.images || []).find((item) => item.isMain) || (content.images || [])[0];
  return media?.secureUrl || media?.url || "";
}

export function isBookContent(content = {}) {
  const category = cleanText(content.category, 80).toLowerCase();
  const topic = cleanText(content.topic, 120).toLowerCase();
  const tags = (content.tags || []).map((tag) => cleanText(tag, 40).toLowerCase());
  return ["book", "books", "reading"].includes(category)
    || ["book", "books", "reading"].includes(topic)
    || tags.some((tag) => ["book", "books", "reading"].includes(tag));
}

export function publicBookFilter() {
  return {
    status: { $in: PUBLIC_CONTENT_STATUSES },
    archivedAt: null,
    $or: [
      { category: /^books?$/iu },
      { category: /^reading$/iu },
      { topic: /^books?$/iu },
      { topic: /^reading$/iu },
      { tags: { $in: ["book", "books", "reading"] } },
    ],
  };
}

function savedItemFilter(userId, targetType, targetId, targetModel) {
  return { user: userId, targetType, targetId, targetModel };
}

async function saveTarget({ targetId, targetModel, targetType, userId }) {
  await SavedItem.findOneAndUpdate(
    savedItemFilter(userId, targetType, targetId, targetModel),
    { $setOnInsert: savedItemFilter(userId, targetType, targetId, targetModel) },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return { saved: true, targetId: String(targetId), targetModel, targetType };
}

async function unsaveTarget({ targetId, targetModel, targetType, userId }) {
  await SavedItem.deleteOne(savedItemFilter(userId, targetType, targetId, targetModel));
  return { saved: false, targetId: String(targetId), targetModel, targetType };
}

export async function savePlace(userId, placeId) {
  requireObjectId(placeId, "place ID");
  const place = await Place.findOne({ _id: placeId, status: "active" }).select("_id").lean();
  if (!place) throw new ApiError(404, "Place is not available");
  return saveTarget({ userId, targetType: "place", targetModel: "Place", targetId: place._id });
}

export async function unsavePlace(userId, placeId) {
  requireObjectId(placeId, "place ID");
  return unsaveTarget({ userId, targetType: "place", targetModel: "Place", targetId: placeId });
}

export async function saveJourney(userId, journeyId) {
  requireObjectId(journeyId, "journey ID");
  const journey = await OrbitDream.findOne({ _id: journeyId, visibility: "public", status: { $in: ["active", "completed"] } }).select("_id").lean();
  if (!journey) throw new ApiError(404, "Journey is not available");
  return saveTarget({ userId, targetType: "journey", targetModel: "OrbitDream", targetId: journey._id });
}

export async function unsaveJourney(userId, journeyId) {
  requireObjectId(journeyId, "journey ID");
  return unsaveTarget({ userId, targetType: "journey", targetModel: "OrbitDream", targetId: journeyId });
}

export async function saveBook(userId, bookId) {
  requireObjectId(bookId, "book ID");
  const book = await Content.findOne({ _id: bookId, ...publicBookFilter() }).select("_id").lean();
  if (!book) throw new ApiError(404, "Book recommendation is not available");
  return saveTarget({ userId, targetType: "book", targetModel: "Content", targetId: book._id });
}

export async function unsaveBook(userId, bookId) {
  requireObjectId(bookId, "book ID");
  return unsaveTarget({ userId, targetType: "book", targetModel: "Content", targetId: bookId });
}

async function findCommentTarget(commentId) {
  requireObjectId(commentId, "comment ID");
  const objectId = new mongoose.Types.ObjectId(commentId);
  const [feedPost, seenComment, wallComment, wallShareComment] = await Promise.all([
    FeedPost.findOne({ status: "published", deletedAt: null, comments: { $elemMatch: { _id: objectId, deletedAt: null } } }).select("_id comments.$").lean(),
    SeenEngagement.findOne({ _id: objectId, type: "COMMENT" }).select("_id").lean(),
    WallEngagement.findOne({ _id: objectId, type: "COMMENT" }).select("_id").lean(),
    WallShareEngagement.findOne({ _id: objectId, type: "COMMENT" }).select("_id").lean(),
  ]);
  if (feedPost?.comments?.length) return { targetModel: "FeedPostComment", targetId: objectId };
  if (seenComment) return { targetModel: "SeenEngagement", targetId: seenComment._id };
  if (wallComment) return { targetModel: "WallEngagement", targetId: wallComment._id };
  if (wallShareComment) return { targetModel: "WallShareEngagement", targetId: wallShareComment._id };
  throw new ApiError(404, "Comment is not available");
}

export async function saveComment(userId, commentId) {
  const target = await findCommentTarget(commentId);
  return saveTarget({ userId, targetType: "comment", ...target });
}

export async function unsaveComment(userId, commentId) {
  requireObjectId(commentId, "comment ID");
  try {
    const target = await findCommentTarget(commentId);
    return unsaveTarget({ userId, targetType: "comment", ...target });
  } catch (error) {
    if (error.statusCode !== 404) throw error;
    await SavedItem.deleteMany({ user: userId, targetType: "comment", targetId: commentId });
    return { saved: false, targetId: String(commentId), targetType: "comment" };
  }
}

async function rowsFor(userId, targetType, { limit, offset }) {
  return SavedItem.find({ user: userId, targetType })
    .sort({ createdAt: -1, _id: -1 })
    .skip(offset)
    .limit(limit)
    .lean();
}

function pagination({ count, hasMore, limit, page }) {
  const total = hasMore ? count + 1 : count;
  return { page, limit, total, pages: Math.ceil(total / limit), hasMore: Boolean(hasMore) };
}

export async function countSavedItems(userId, targetType, targetModel) {
  const rows = await SavedItem.find({ user: userId, targetType, ...(targetModel ? { targetModel } : {}) }).select("targetId targetModel").lean();
  if (!rows.length) return 0;
  if (targetType === "place") return Place.countDocuments({ _id: { $in: rows.filter((row) => row.targetModel === "Place").map((row) => row.targetId) }, status: "active" });
  if (targetType === "journey") return OrbitDream.countDocuments({ _id: { $in: rows.map((row) => row.targetId) }, visibility: "public", status: { $in: ["active", "completed"] } });
  if (targetType === "book") return Content.countDocuments({ _id: { $in: rows.map((row) => row.targetId) }, ...publicBookFilter() });
  if (targetType !== "comment") return rows.length;

  const idsByModel = rows.reduce((map, row) => {
    map.set(row.targetModel, [...(map.get(row.targetModel) || []), row.targetId]);
    return map;
  }, new Map());
  const feedCommentIds = idsByModel.get("FeedPostComment") || [];
  const [feedPosts, seenCount, wallCount, wallShareCount] = await Promise.all([
    feedCommentIds.length ? FeedPost.find({ status: "published", deletedAt: null, "comments._id": { $in: feedCommentIds } }).select("comments._id comments.deletedAt").lean() : [],
    idsByModel.has("SeenEngagement") ? SeenEngagement.countDocuments({ _id: { $in: idsByModel.get("SeenEngagement") }, type: "COMMENT" }) : 0,
    idsByModel.has("WallEngagement") ? WallEngagement.countDocuments({ _id: { $in: idsByModel.get("WallEngagement") }, type: "COMMENT" }) : 0,
    idsByModel.has("WallShareEngagement") ? WallShareEngagement.countDocuments({ _id: { $in: idsByModel.get("WallShareEngagement") }, type: "COMMENT" }) : 0,
  ]);
  const feedIdSet = new Set(feedCommentIds.map(String));
  const feedCount = feedPosts.reduce((sum, post) => sum + (post.comments || []).filter((comment) => feedIdSet.has(String(comment._id)) && !comment.deletedAt).length, 0);
  return feedCount + seenCount + wallCount + wallShareCount;
}

export async function unlockedExperienceRows(userId) {
  const now = new Date();
  const [worlds, memberships, walked] = await Promise.all([
    WorldEntitlement.find({ user: userId, status: "ACTIVE" }).select("publication grantedAt createdAt").lean(),
    PremiumMembership.find({ user: userId, status: { $in: ACTIVE_MEMBERSHIP_STATUSES }, currentPeriodEnd: { $gt: now } }).select("premiumPublication currentPeriodStart createdAt status currentPeriodEnd").lean(),
    SeenEngagement.find({ user: userId, type: "WALKED" }).select("publication createdAt").lean(),
  ]);
  const access = new Map();
  for (const row of worlds) access.set(String(row.publication), { accessType: "ENTITLED_WORLD", unlockedAt: row.grantedAt || row.createdAt });
  for (const row of memberships) access.set(String(row.premiumPublication), { accessType: "ACTIVE_PREMIUM_MEMBER", membershipStatus: row.status, subscriptionEndsAt: row.currentPeriodEnd, unlockedAt: row.currentPeriodStart || row.createdAt });
  for (const row of walked) {
    const key = String(row.publication);
    if (!access.has(key)) access.set(key, { accessType: "OPENED_FREE_WORLD", unlockedAt: row.createdAt });
  }
  const ids = [...access.keys()].filter(mongoose.isValidObjectId);
  if (!ids.length) return [];
  const publications = await Publication.find({
    _id: { $in: ids },
    kind: { $in: WORLD_KINDS },
    status: "PUBLISHED",
    publishedSnapshot: { $exists: true },
  }).populate("creator", "name username avatar isVerified").lean();
  return publications
    .filter((publication) => {
      const item = access.get(String(publication._id));
      const price = Number(publication.pricing?.starsAmount || publication.publishedSnapshot?.metadata?.pricing?.starsAmount || 0);
      return item.accessType !== "OPENED_FREE_WORLD" || publication.pricing?.mode === "FREE" || price <= 0;
    })
    .map((publication) => {
      const item = access.get(String(publication._id));
      const serialized = serializePublication(publication, { _id: userId }, { entitlement: item.accessType === "ACTIVE_PREMIUM_MEMBER" ? "ACTIVE_PREMIUM_MEMBER" : item.accessType });
      return serialized ? { ...serialized, ...item, unlockedAt: item.unlockedAt, viewerUnlocked: true, viewerSaved: false } : null;
    })
    .filter(Boolean)
    .sort((left, right) => new Date(right.unlockedAt || 0) - new Date(left.unlockedAt || 0));
}

export async function listSavedPlaces(userId, paging) {
  const rows = (await rowsFor(userId, "place", { limit: paging.limit + 1, offset: paging.offset })).filter((row) => row.targetModel === "Place");
  const ids = rows.map((row) => row.targetId);
  const records = ids.length ? await Place.find({ _id: { $in: ids }, status: "active" }).populate("createdBy", "name username avatar isVerified").lean() : [];
  const byId = new Map(records.map((item) => [String(item._id), item]));
  const items = rows.map((row) => {
    const place = byId.get(String(row.targetId));
    if (!place) return null;
    return {
      id: String(place._id),
      title: place.name,
      name: place.name,
      description: cleanText(place.description, 260),
      image: place.image || "",
      address: place.address || "",
      city: place.city,
      country: place.country,
      location: [place.city, place.country].filter(Boolean).join(", "),
      category: place.category || "Place",
      saved: true,
      savedAt: row.createdAt,
      route: `/places/${place._id}`,
      creator: authorPayload(place.createdBy),
    };
  }).filter(Boolean);
  const pageItems = items.slice(0, paging.limit);
  return { items: pageItems, pagination: pagination({ count: paging.offset + pageItems.length, hasMore: items.length > paging.limit, limit: paging.limit, page: paging.page }) };
}

export async function listSavedJourneys(userId, paging) {
  const rows = await rowsFor(userId, "journey", { limit: paging.limit + 1, offset: paging.offset });
  const ids = rows.map((row) => row.targetId);
  const records = ids.length ? await OrbitDream.find({ _id: { $in: ids }, visibility: "public", status: { $in: ["active", "completed"] } }).populate("user", "name username avatar isVerified").lean() : [];
  const byId = new Map(records.filter((item) => item.user).map((item) => [String(item._id), item]));
  const items = rows.map((row) => {
    const journey = byId.get(String(row.targetId));
    if (!journey) return null;
    return {
      id: String(journey._id),
      title: journey.title,
      emoji: journey.emoji || "",
      icon: journey.emoji || "",
      city: "",
      location: "",
      saved: true,
      savedAt: row.createdAt,
      started: false,
      completed: journey.status === "completed",
      visitedCount: 0,
      totalSteps: 0,
      localTipCount: 0,
      route: journey.user?.username ? `/profile/${encodeURIComponent(journey.user.username)}` : "/orbit",
      creator: authorPayload(journey.user),
    };
  }).filter(Boolean);
  const pageItems = items.slice(0, paging.limit);
  return { items: pageItems, pagination: pagination({ count: paging.offset + pageItems.length, hasMore: items.length > paging.limit, limit: paging.limit, page: paging.page }) };
}

export async function listSavedExperiences(userId, paging) {
  const rows = await unlockedExperienceRows(userId);
  const items = rows.slice(paging.offset, paging.offset + paging.limit).map((item) => ({
    ...item,
    chapterCount: item.chapters?.length || 0,
    creator: item.creator,
    viewerUnlocked: true,
    route: `/world/${item.id}`,
  }));
  return {
    items,
    pagination: { page: paging.page, limit: paging.limit, total: rows.length, pages: Math.ceil(rows.length / paging.limit), hasMore: paging.offset + items.length < rows.length },
  };
}

export async function listSavedBooks(userId, paging) {
  const rows = await rowsFor(userId, "book", { limit: paging.limit + 1, offset: paging.offset });
  const ids = rows.map((row) => row.targetId);
  const records = ids.length ? await Content.find({ _id: { $in: ids }, ...publicBookFilter() }).populate("creator", "name username avatar isVerified").lean() : [];
  const byId = new Map(records.map((item) => [String(item._id), item]));
  const items = rows.map((row) => {
    const book = byId.get(String(row.targetId));
    if (!book) return null;
    return {
      id: String(book._id),
      title: book.title,
      recommendationText: cleanText(book.description || book.body, 260),
      description: cleanText(book.description || book.body, 260),
      image: contentMedia(book),
      cover: contentMedia(book),
      category: book.category || "Books",
      topic: book.topic || "",
      saved: true,
      savedAt: row.createdAt,
      route: `/books/${book._id}`,
      creator: authorPayload(book.creator),
    };
  }).filter(Boolean);
  const pageItems = items.slice(0, paging.limit);
  return { items: pageItems, pagination: pagination({ count: paging.offset + pageItems.length, hasMore: items.length > paging.limit, limit: paging.limit, page: paging.page }) };
}

export async function listSavedComments(userId, paging) {
  const rows = await rowsFor(userId, "comment", { limit: paging.limit + 1, offset: paging.offset });
  const idsByModel = rows.reduce((map, row) => {
    map.set(row.targetModel, [...(map.get(row.targetModel) || []), row.targetId]);
    return map;
  }, new Map());
  const [feedPosts, seenComments, wallComments, wallShareComments] = await Promise.all([
    idsByModel.has("FeedPostComment") ? FeedPost.find({ status: "published", deletedAt: null, "comments._id": { $in: idsByModel.get("FeedPostComment") } }).populate("author", "name username avatar isVerified").populate("comments.user", "name username avatar isVerified").lean() : [],
    idsByModel.has("SeenEngagement") ? SeenEngagement.find({ _id: { $in: idsByModel.get("SeenEngagement") }, type: "COMMENT" }).populate("user", "name username avatar isVerified").populate({ path: "publication", select: "title kind creator status", populate: { path: "creator", select: "name username avatar isVerified" } }).lean() : [],
    idsByModel.has("WallEngagement") ? WallEngagement.find({ _id: { $in: idsByModel.get("WallEngagement") }, type: "COMMENT" }).populate("user", "name username avatar isVerified").populate({ path: "post", match: { status: "PUBLISHED" }, populate: { path: "creator", select: "name username avatar isVerified" } }).lean() : [],
    idsByModel.has("WallShareEngagement") ? WallShareEngagement.find({ _id: { $in: idsByModel.get("WallShareEngagement") }, type: "COMMENT" }).populate("user", "name username avatar isVerified").populate({ path: "share", match: { type: "SHARE" }, populate: [{ path: "user", select: "name username avatar isVerified" }, { path: "post", match: { status: "PUBLISHED" }, populate: { path: "creator", select: "name username avatar isVerified" } }] }).lean() : [],
  ]);
  const feedByComment = new Map();
  for (const post of feedPosts) {
    for (const comment of post.comments || []) {
      if (comment.deletedAt) continue;
      feedByComment.set(String(comment._id), { comment, post });
    }
  }
  const seenById = new Map(seenComments.filter((item) => item.publication).map((item) => [String(item._id), item]));
  const wallById = new Map(wallComments.filter((item) => item.post).map((item) => [String(item._id), item]));
  const shareById = new Map(wallShareComments.filter((item) => item.share?.post).map((item) => [String(item._id), item]));
  const items = rows.map((row) => {
    if (row.targetModel === "FeedPostComment") {
      const found = feedByComment.get(String(row.targetId));
      if (!found) return null;
      return {
        id: String(row._id),
        commentId: String(found.comment._id),
        text: found.comment.text,
        savedAt: row.createdAt,
        createdAt: found.comment.createdAt,
        author: authorPayload(found.comment.user),
        parent: { type: "post", id: String(found.post._id), title: cleanText(found.post.text, 90) || "Home post", author: authorPayload(found.post.author), route: `/posts/${found.post._id}` },
      };
    }
    if (row.targetModel === "SeenEngagement") {
      const comment = seenById.get(String(row.targetId));
      if (!comment) return null;
      return {
        id: String(row._id),
        commentId: String(comment._id),
        text: comment.text,
        savedAt: row.createdAt,
        createdAt: comment.createdAt,
        author: authorPayload(comment.user),
        parent: { type: comment.publication?.kind === "SEEN" ? "seen" : "world", id: String(comment.publication?._id), title: comment.publication?.title || "Seen", author: authorPayload(comment.publication?.creator), route: comment.publication?.kind === "SEEN" ? `/seen/${comment.publication?._id}` : `/world/${comment.publication?._id}` },
      };
    }
    if (row.targetModel === "WallEngagement") {
      const comment = wallById.get(String(row.targetId));
      if (!comment) return null;
      return {
        id: String(row._id),
        commentId: String(comment._id),
        text: comment.text,
        savedAt: row.createdAt,
        createdAt: comment.createdAt,
        author: authorPayload(comment.user),
        parent: { type: "wallPost", id: String(comment.post?._id), title: cleanText(comment.post?.text, 90) || "Wall post", author: authorPayload(comment.post?.creator), route: `/wall?post=${comment.post?._id}` },
      };
    }
    const comment = shareById.get(String(row.targetId));
    if (!comment) return null;
    return {
      id: String(row._id),
      commentId: String(comment._id),
      text: comment.text,
      savedAt: row.createdAt,
      createdAt: comment.createdAt,
      author: authorPayload(comment.user),
      parent: { type: "wallShare", id: String(comment.share?.post?._id), title: cleanText(comment.share?.post?.text, 90) || "Shared Wall post", author: authorPayload(comment.share?.post?.creator), sharedBy: authorPayload(comment.share?.user), route: `/wall?post=${comment.share?.post?._id}&shareId=${comment.share?._id}` },
    };
  }).filter(Boolean);
  const pageItems = items.slice(0, paging.limit);
  return { items: pageItems, pagination: pagination({ count: paging.offset + pageItems.length, hasMore: items.length > paging.limit, limit: paging.limit, page: paging.page }) };
}

export const savedService = {
  countSavedItems,
  isBookContent,
  listSavedBooks,
  listSavedComments,
  listSavedExperiences,
  listSavedJourneys,
  listSavedPlaces,
  saveBook,
  saveComment,
  saveJourney,
  savePlace,
  unlockedExperienceRows,
  unsaveBook,
  unsaveComment,
  unsaveJourney,
  unsavePlace,
};
