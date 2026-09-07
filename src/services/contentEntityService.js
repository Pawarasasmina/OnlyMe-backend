import mongoose from "mongoose";
import Content from "../models/Content.js";
import OrbitDream from "../models/OrbitDream.js";
import Place from "../models/Place.js";
import Publication from "../models/Publication.js";
import SavedItem from "../models/SavedItem.js";
import { CONTENT_ENTITY_TARGET_MODELS, CONTENT_ENTITY_TYPES } from "../constants/contentEntityConstants.js";
import { publicBookFilter } from "./savedService.js";
import { publicationAccess } from "./publicationAccessService.js";
import ApiError from "../utils/ApiError.js";

const MAX_ENTITY_REFS = 4;
const MAX_SEARCH_LIMIT = 12;

function cleanText(value, maxLength = 160) {
  return String(value || "").replace(/\s+/gu, " ").trim().slice(0, maxLength);
}

function parseRefs(value) {
  if (!value) return [];
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      throw new ApiError(400, "Attached entities must be valid JSON");
    }
  }
  return value;
}

function readEntityRef(raw = {}) {
  const entityType = String(raw.entityType || raw.type || "").trim().toLowerCase();
  const entityId = String(raw.entityId || raw.id || raw.targetId || "").trim();
  if (!CONTENT_ENTITY_TYPES.includes(entityType)) throw new ApiError(400, "Unsupported attached entity type");
  if (!mongoose.isValidObjectId(entityId)) throw new ApiError(400, "Attached entity ID must be valid");
  return { entityType, entityId: new mongoose.Types.ObjectId(entityId) };
}

export function normalizeEntityRefsInput(value) {
  const refs = parseRefs(value);
  if (!Array.isArray(refs)) throw new ApiError(400, "Attached entities must be an array");
  const unique = new Map();
  refs.slice(0, MAX_ENTITY_REFS).forEach((raw) => {
    const ref = readEntityRef(raw);
    unique.set(`${ref.entityType}:${ref.entityId}`, ref);
  });
  return [...unique.values()];
}

function idsFor(refs, type) {
  return refs.filter((ref) => ref.entityType === type).map((ref) => ref.entityId);
}

function refsForRecord(record, viewer = null) {
  const ownerId = record?.creator?._id || record?.creator;
  const isOwner = viewer?._id && ownerId && String(viewer._id) === String(ownerId);
  if (!isOwner && record?.publishedSnapshot?.metadata?.entityRefs?.length) return record.publishedSnapshot.metadata.entityRefs;
  return record?.entityRefs || record?.publishedSnapshot?.metadata?.entityRefs || [];
}

export async function validateEntityRefs(value) {
  const refs = normalizeEntityRefsInput(value);
  if (!refs.length) return [];
  const [places, books, journeys, experiences] = await Promise.all([
    idsFor(refs, "place").length ? Place.find({ _id: { $in: idsFor(refs, "place") }, status: "active" }).select("_id").lean() : [],
    idsFor(refs, "book").length ? Content.find({ _id: { $in: idsFor(refs, "book") }, ...publicBookFilter() }).select("_id").lean() : [],
    idsFor(refs, "journey").length ? OrbitDream.find({ _id: { $in: idsFor(refs, "journey") }, visibility: "public", status: { $in: ["active", "completed"] } }).select("_id").lean() : [],
    idsFor(refs, "experience").length ? Publication.find({ _id: { $in: idsFor(refs, "experience") }, kind: { $in: ["WORLD", "PREMIUM_WORLD"] }, status: "PUBLISHED", publishedSnapshot: { $exists: true } }).select("_id").lean() : [],
  ]);
  const available = new Set([
    ...places.map((item) => `place:${item._id}`),
    ...books.map((item) => `book:${item._id}`),
    ...journeys.map((item) => `journey:${item._id}`),
    ...experiences.map((item) => `experience:${item._id}`),
  ]);
  const missing = refs.find((ref) => !available.has(`${ref.entityType}:${ref.entityId}`));
  if (missing) throw new ApiError(400, `${missing.entityType} attachment is not available`);
  return refs;
}

function mediaUrl(content = {}) {
  const primary = content.thumbnail || (content.media || []).find((item) => item.isPrimary) || (content.media || [])[0] || (content.images || []).find((item) => item.isMain) || (content.images || [])[0];
  return primary?.secureUrl || primary?.url || "";
}

function creatorPayload(user = {}) {
  return user?._id ? {
    id: String(user._id),
    name: user.name || user.username || "Creator",
    username: user.username || "",
    avatar: user.avatar || "",
    verified: Boolean(user.isVerified),
  } : null;
}

function publicLocation(city, country) {
  return [city, country].map((value) => cleanText(value, 80)).filter(Boolean).join(", ");
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function regexFor(query) {
  return new RegExp(escapeRegex(query), "iu");
}

function parseLimit(value) {
  return Math.min(MAX_SEARCH_LIMIT, Math.max(1, Number.parseInt(value, 10) || 8));
}

function serializePlace(place, saved) {
  return {
    id: String(place._id),
    type: "place",
    targetModel: "Place",
    title: place.name,
    subtitle: publicLocation(place.city, place.country) || place.address || place.category || "Place",
    description: cleanText(place.description, 260),
    image: place.image || "",
    category: place.category || "Place",
    city: place.city || "",
    country: place.country || "",
    address: place.address || "",
    creator: creatorPayload(place.createdBy),
    route: `/places/${place._id}`,
    saved,
    saveTarget: { type: "place", id: String(place._id) },
  };
}

function serializeBook(book, saved) {
  return {
    id: String(book._id),
    type: "book",
    targetModel: "Content",
    title: book.title,
    subtitle: [book.topic, book.creator?.name].filter(Boolean).join(" - ") || book.category || "Book",
    description: cleanText(book.description || book.body, 260),
    image: mediaUrl(book),
    category: book.category || "Books",
    route: `/books/${book._id}`,
    creator: creatorPayload(book.creator),
    saved,
    saveTarget: { type: "book", id: String(book._id) },
  };
}

function serializeJourney(journey, saved) {
  return {
    id: String(journey._id),
    type: "journey",
    targetModel: "OrbitDream",
    title: journey.title,
    subtitle: journey.user?.name || "Journey",
    description: "Public creator journey",
    image: journey.user?.avatar || "",
    icon: journey.emoji || "",
    route: journey.user?.username ? `/profile/${encodeURIComponent(journey.user.username)}` : "/orbit",
    creator: creatorPayload(journey.user),
    saved,
    saveTarget: { type: "journey", id: String(journey._id) },
  };
}

function serializeExperience(publication, viewer) {
  const snapshot = publication.publishedSnapshot?.metadata || publication;
  const access = publicationAccess(publication, viewer);
  return {
    id: String(publication._id),
    type: "experience",
    targetModel: "Publication",
    title: snapshot.title || publication.title,
    subtitle: [publication.creator?.name, snapshot.category].filter(Boolean).join(" - ") || "Experience",
    description: cleanText(snapshot.description || snapshot.summary, 260),
    image: snapshot.coverMedia?.secureUrl || snapshot.introMedia?.secureUrl || "",
    category: snapshot.category || publication.category || "",
    route: `/world/${publication._id}`,
    creator: creatorPayload(publication.creator),
    locked: access === "PUBLIC_PREVIEW",
    saved: false,
    saveTarget: null,
  };
}

async function savedIdsFor({ ids, targetModel, targetType, user }) {
  if (!user?._id || !ids.length) return new Set();
  const rows = await SavedItem.find({ user: user._id, targetType, targetModel, targetId: { $in: ids } }).select("targetId").lean();
  return new Set(rows.map((row) => String(row.targetId)));
}

export async function attachEntityMetadata(records, viewer = null) {
  const list = Array.isArray(records) ? records : [records];
  const refs = list.flatMap((record) => refsForRecord(record, viewer));
  if (!refs.length) return records;
  const byType = CONTENT_ENTITY_TYPES.reduce((map, type) => ({ ...map, [type]: idsFor(refs, type) }), {});
  const [places, books, journeys, experiences, savedRows] = await Promise.all([
    byType.place.length ? Place.find({ _id: { $in: byType.place }, status: "active" }).populate("createdBy", "name username avatar isVerified").lean() : [],
    byType.book.length ? Content.find({ _id: { $in: byType.book }, ...publicBookFilter() }).populate("creator", "name username avatar isVerified").lean() : [],
    byType.journey.length ? OrbitDream.find({ _id: { $in: byType.journey }, visibility: "public", status: { $in: ["active", "completed"] } }).populate("user", "name username avatar isVerified").lean() : [],
    byType.experience.length ? Publication.find({ _id: { $in: byType.experience }, kind: { $in: ["WORLD", "PREMIUM_WORLD"] }, status: "PUBLISHED", publishedSnapshot: { $exists: true } }).populate("creator", "name username avatar isVerified").lean() : [],
    viewer?._id && refs.length ? SavedItem.find({
      user: viewer._id,
      $or: CONTENT_ENTITY_TYPES.map((type) => ({
        targetType: type,
        targetModel: CONTENT_ENTITY_TARGET_MODELS[type],
        targetId: { $in: byType[type] },
      })),
    }).select("targetType targetModel targetId").lean() : [],
  ]);
  const saved = new Set(savedRows.map((row) => `${row.targetType}:${row.targetModel}:${row.targetId}`));
  const collections = {
    book: new Map(books.map((item) => [String(item._id), item])),
    experience: new Map(experiences.map((item) => [String(item._id), item])),
    journey: new Map(journeys.map((item) => [String(item._id), item])),
    place: new Map(places.map((item) => [String(item._id), item])),
  };
  for (const record of list) {
    const sourceRefs = refsForRecord(record, viewer);
    const attachedEntities = sourceRefs.map((ref) => {
      const id = String(ref.entityId);
      if (ref.entityType === "place" && collections.place.has(id)) return serializePlace(collections.place.get(id), saved.has(`place:Place:${id}`));
      if (ref.entityType === "book" && collections.book.has(id)) return serializeBook(collections.book.get(id), saved.has(`book:Content:${id}`));
      if (ref.entityType === "journey" && collections.journey.has(id)) return serializeJourney(collections.journey.get(id), saved.has(`journey:OrbitDream:${id}`));
      if (ref.entityType === "experience" && collections.experience.has(id)) return serializeExperience(collections.experience.get(id), viewer);
      return null;
    }).filter(Boolean);
    if (typeof record.set === "function") record.set("attachedEntities", attachedEntities, { strict: false });
    record.attachedEntities = attachedEntities;
  }
  return records;
}

export async function searchEntities({ q, type, user, limit }) {
  const entityType = String(type || "").toLowerCase();
  if (!CONTENT_ENTITY_TYPES.includes(entityType)) throw new ApiError(400, "Unsupported attached entity type");
  const query = cleanText(q, 80);
  if (query.length < 2) return { items: [] };
  const safeLimit = parseLimit(limit);
  const matcher = regexFor(query);

  if (entityType === "place") {
    const records = await Place.find({
      status: "active",
      $or: [{ name: matcher }, { city: matcher }, { country: matcher }, { address: matcher }, { category: matcher }],
    }).sort({ name: 1, city: 1 }).limit(safeLimit).populate("createdBy", "name username avatar isVerified").lean();
    const saved = await savedIdsFor({ ids: records.map((item) => item._id), targetModel: "Place", targetType: "place", user });
    return { items: records.map((item) => serializePlace(item, saved.has(String(item._id)))) };
  }

  if (entityType === "book") {
    const records = await Content.find({
      $and: [
        publicBookFilter(),
        { $or: [{ title: matcher }, { topic: matcher }, { description: matcher }, { category: matcher }, { tags: matcher }] },
      ],
    }).sort({ publishedAt: -1, createdAt: -1 }).limit(safeLimit).populate("creator", "name username avatar isVerified").lean();
    const saved = await savedIdsFor({ ids: records.map((item) => item._id), targetModel: "Content", targetType: "book", user });
    return { items: records.map((item) => serializeBook(item, saved.has(String(item._id)))) };
  }

  if (entityType === "journey") {
    const records = await OrbitDream.find({
      visibility: "public",
      status: { $in: ["active", "completed"] },
      title: matcher,
    }).sort({ supporterCount: -1, updatedAt: -1 }).limit(safeLimit).populate("user", "name username avatar isVerified").lean();
    const saved = await savedIdsFor({ ids: records.map((item) => item._id), targetModel: "OrbitDream", targetType: "journey", user });
    return { items: records.filter((item) => item.user).map((item) => serializeJourney(item, saved.has(String(item._id)))) };
  }

  const records = await Publication.find({
    kind: { $in: ["WORLD", "PREMIUM_WORLD"] },
    status: "PUBLISHED",
    publishedSnapshot: { $exists: true },
    $or: [{ title: matcher }, { summary: matcher }, { description: matcher }, { category: matcher }, { tags: matcher }],
  }).sort({ publishedAt: -1, createdAt: -1 }).limit(safeLimit).populate("creator", "name username avatar isVerified").lean();
  return { items: records.map((item) => serializeExperience(item, user)) };
}

export async function getEntityDetail({ id, type, user }) {
  const entityType = String(type || "").toLowerCase();
  if (!CONTENT_ENTITY_TYPES.includes(entityType)) throw new ApiError(400, "Unsupported attached entity type");
  if (!mongoose.isValidObjectId(id)) throw new ApiError(400, "Invalid attached entity ID");

  if (entityType === "place") {
    const place = await Place.findOne({ _id: id, status: "active" }).populate("createdBy", "name username avatar isVerified").lean();
    if (!place) throw new ApiError(404, "Place is not available");
    const saved = await savedIdsFor({ ids: [place._id], targetModel: "Place", targetType: "place", user });
    return { entity: serializePlace(place, saved.has(String(place._id))) };
  }

  if (entityType === "book") {
    const book = await Content.findOne({ _id: id, ...publicBookFilter() }).populate("creator", "name username avatar isVerified").lean();
    if (!book) throw new ApiError(404, "Book recommendation is not available");
    const saved = await savedIdsFor({ ids: [book._id], targetModel: "Content", targetType: "book", user });
    return { entity: serializeBook(book, saved.has(String(book._id))) };
  }

  if (entityType === "journey") {
    const journey = await OrbitDream.findOne({ _id: id, visibility: "public", status: { $in: ["active", "completed"] } }).populate("user", "name username avatar isVerified").lean();
    if (!journey?.user) throw new ApiError(404, "Journey is not available");
    const saved = await savedIdsFor({ ids: [journey._id], targetModel: "OrbitDream", targetType: "journey", user });
    return { entity: serializeJourney(journey, saved.has(String(journey._id))) };
  }

  const publication = await Publication.findOne({ _id: id, kind: { $in: ["WORLD", "PREMIUM_WORLD"] }, status: "PUBLISHED", publishedSnapshot: { $exists: true } }).populate("creator", "name username avatar isVerified").lean();
  if (!publication) throw new ApiError(404, "Experience is not available");
  return { entity: serializeExperience(publication, user) };
}

export const contentEntityService = {
  attachEntityMetadata,
  getEntityDetail,
  normalizeEntityRefsInput,
  searchEntities,
  validateEntityRefs,
};
