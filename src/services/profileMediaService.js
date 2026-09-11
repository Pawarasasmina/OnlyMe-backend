import mongoose from "mongoose";
import Chapter from "../models/Chapter.js";
import ProfileMedia from "../models/ProfileMedia.js";
import Publication from "../models/Publication.js";
import Story from "../models/Story.js";
import User from "../models/User.js";
import MessageReport from "../models/MessageReport.js";
import { deleteProfileMediaFile, uploadProfileMediaFile } from "./profileMediaStorageService.js";
import { publicationDeliveryUrl } from "./publicationMediaStorageService.js";
import ApiError from "../utils/ApiError.js";
import { normalizeUsername } from "../validators/profileValidator.js";

const SOURCE_MEDIA_ID = {
  seenCover: "cover",
  story: "media",
};

const sourceLinkedFilter = ({ sourceId, sourceMediaId, sourceType, userId }) => ({
  sourceId,
  sourceMediaId,
  sourceType,
  user: userId,
});

const isDuplicateKey = (error) => error?.code === 11000;

const nextSortOrderForUser = async (userId) => {
  const latest = await ProfileMedia.findOne({ user: userId }).sort({ sortOrder: -1 }).select("sortOrder").lean();
  return Number(latest?.sortOrder || 0) + 1;
};

export function serializeProfileMedia(item = {}, { includeSourceIds = false, viewerId = null } = {}) {
  const likedBy = Array.isArray(item.likedBy) ? item.likedBy : [];
  const result = {
    id: String(item._id || item.id || ""),
    type: item.type,
    mediaType: item.type,
    url: item.url,
    mediaUrl: item.url,
    thumbnailUrl: item.thumbnailUrl || item.url,
    mimeType: item.mimeType || "",
    width: Number(item.width) || 0,
    height: Number(item.height) || 0,
    duration: Number(item.duration) || 0,
    size: Number(item.size) || 0,
    caption: item.caption || "",
    likeCount: likedBy.length,
    viewerLiked: Boolean(viewerId && likedBy.some((id) => String(id) === String(viewerId))),
    sourceType: item.sourceType || "direct",
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
  };
  if (includeSourceIds) {
    result.sourceId = item.sourceId ? String(item.sourceId) : null;
    result.sourceMediaId = item.sourceMediaId || "";
  }
  return result;
}

export async function profileMediaOwnerByUsername(username) {
  const owner = await User.findOne({ username: normalizeUsername(username), role: { $in: ["fan", "creator"] }, status: "active" }).select("_id username role status");
  if (!owner) throw new ApiError(404, "Profile not found");
  return owner;
}

export async function listProfileMediaForUser(userId, { limit = 60, viewerId = null } = {}) {
  const items = await ProfileMedia.find({ user: userId })
    .sort({ sortOrder: -1, createdAt: -1, _id: -1 })
    .limit(Math.min(100, Math.max(1, Number(limit) || 60)))
    .lean();
  return items.map((item) => serializeProfileMedia(item, { viewerId }));
}

export async function listOwnProfileMedia(userId, { limit = 60 } = {}) {
  const items = await ProfileMedia.find({ user: userId })
    .sort({ sortOrder: -1, createdAt: -1, _id: -1 })
    .limit(Math.min(100, Math.max(1, Number(limit) || 60)))
    .lean();
  return items.map((item) => serializeProfileMedia(item, { includeSourceIds: true, viewerId: userId }));
}

export async function toggleProfileMediaLike({ mediaId, username, user }) {
  if (!mongoose.isValidObjectId(mediaId)) throw new ApiError(400, "Invalid Profile Media item");
  const owner = await profileMediaOwnerByUsername(username);
  const item = await ProfileMedia.findOne({ _id: mediaId, user: owner._id });
  if (!item) throw new ApiError(404, "Profile Media item not found");
  const liked = item.likedBy.some((id) => String(id) === String(user._id));
  if (liked) item.likedBy.pull(user._id);
  else item.likedBy.addToSet(user._id);
  await item.save();
  return { liked: !liked, likeCount: item.likedBy.length, mediaId: String(item._id) };
}

const PROFILE_MEDIA_REPORT_REASONS = new Set(["SPAM", "FALSE_INFORMATION", "HARASSMENT", "HATE", "NUDITY", "SEXUAL_CONTENT", "VIOLENCE", "ILLEGAL_CONTENT", "COPYRIGHT", "SCAM", "OTHER"]);

export async function reportProfileMedia({ mediaId, payload = {}, username, user }) {
  if (!mongoose.isValidObjectId(mediaId)) throw new ApiError(400, "Invalid Profile Media item");
  const owner = await profileMediaOwnerByUsername(username);
  if (String(owner._id) === String(user._id)) throw new ApiError(400, "You cannot report your own Media");
  const item = await ProfileMedia.findOne({ _id: mediaId, user: owner._id }).lean();
  if (!item) throw new ApiError(404, "Profile Media item not found");
  const reason = String(payload.reason || "OTHER").trim().toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_");
  if (!PROFILE_MEDIA_REPORT_REASONS.has(reason)) throw new ApiError(400, "Select a valid report reason");
  try {
    const report = await MessageReport.create({
      reporter: user._id,
      reportedUser: owner._id,
      scope: "PROFILE_MEDIA",
      profileMedia: item._id,
      reason,
      details: String(payload.details || "").trim().slice(0, 1000),
      snapshot: { mediaId: String(item._id), ownerId: String(owner._id), username: owner.username, type: item.type, url: item.url, thumbnailUrl: item.thumbnailUrl || "" },
    });
    return { reportId: String(report._id), status: report.status };
  } catch (error) {
    if (error?.code === 11000) throw new ApiError(409, "You already reported this Media");
    throw error;
  }
}

export async function profileMediaReferencesAsset(assetId) {
  if (!assetId) return false;
  return Boolean(await ProfileMedia.exists({ assetId }));
}

export async function profileMediaSourceKeysFor({ sourceIds = [], sourceType, userId }) {
  const validSourceIds = sourceIds.filter((id) => mongoose.isValidObjectId(id));
  if (!validSourceIds.length || !sourceType || !userId) return new Set();
  const rows = await ProfileMedia.find({ user: userId, sourceType, sourceId: { $in: validSourceIds } }).select("sourceId sourceMediaId").lean();
  return new Set(rows.map((item) => `${String(item.sourceId)}:${item.sourceMediaId || ""}`));
}

export async function createProfileMedia({ caption = "", file, user }) {
  if (!["fan", "creator"].includes(user?.role)) throw new ApiError(403, "Profile Media is available to fan and creator accounts");
  if (!file) throw new ApiError(400, "Choose a photo or short video");
  const stored = await uploadProfileMediaFile({ file, userId: user._id });
  try {
    const item = await ProfileMedia.create({
      ...stored,
      caption: String(caption || "").trim().slice(0, 160),
      sortOrder: await nextSortOrderForUser(user._id),
      sourceType: "direct",
      user: user._id,
    });
    return serializeProfileMedia(item);
  } catch (error) {
    await deleteProfileMediaFile(stored).catch(() => {});
    throw error;
  }
}

export async function removeOwnProfileMedia({ mediaId, user }) {
  if (!mongoose.isValidObjectId(mediaId)) throw new ApiError(400, "Invalid Profile Media item");
  const item = await ProfileMedia.findOne({ _id: mediaId, user: user._id });
  if (!item) throw new ApiError(404, "Profile Media item not found");
  await item.deleteOne();
  if (item.sourceType === "direct") await deleteProfileMediaFile(item).catch(() => {});
  return { mediaId: String(item._id), removed: true };
}

function storyProfileMediaPayload(story) {
  if (!["image", "video"].includes(story?.mediaType)) throw new ApiError(400, "This Story type can't be added to Media");
  if (!story?.image?.assetId || !story?.image?.url) throw new ApiError(400, "Story media is not available");
  const resourceType = story.image.resourceType === "video" || story.mediaType === "video" ? "video" : "image";
  return {
    assetId: story.image.assetId,
    duration: story.mediaType === "video" ? Number(story.duration) || 0 : 0,
    format: "",
    height: 0,
    mimeType: resourceType === "video" ? "video/mp4" : "image/jpeg",
    resourceType,
    size: 0,
    thumbnailUrl: story.image.url,
    type: story.mediaType,
    url: story.image.url,
    width: 0,
  };
}

function profileMediaPayloadFromPublicationMedia(media) {
  if (!media || !["IMAGE", "VIDEO"].includes(media.mediaType)) throw new ApiError(400, "This Seen item can't be added to Media");
  const type = media.mediaType === "VIDEO" ? "video" : "image";
  const url = publicationDeliveryUrl(media);
  if (!media.assetId || !url) throw new ApiError(400, "Seen media is not available");
  return {
    assetId: media.assetId,
    duration: Number(media.duration) || 0,
    format: String(media.format || "").toLowerCase(),
    height: Number(media.height) || 0,
    mimeType: type === "video" ? `video/${String(media.format || "mp4").toLowerCase()}` : `image/${String(media.format || "jpeg").toLowerCase()}`,
    resourceType: media.resourceType || type,
    size: Number(media.bytes) || 0,
    thumbnailUrl: type === "video" ? url : url,
    type,
    url,
    width: Number(media.width) || 0,
  };
}

async function createSourceProfileMedia({ mediaPayload, sourceId, sourceMediaId, sourceType, user }) {
  const filter = sourceLinkedFilter({ sourceId, sourceMediaId, sourceType, userId: user._id });
  const existing = await ProfileMedia.findOne(filter);
  if (existing) return { media: serializeProfileMedia(existing, { includeSourceIds: true }), skippedDuplicate: true };
  try {
    const item = await ProfileMedia.create({
      ...mediaPayload,
      ...filter,
      caption: "",
      sortOrder: await nextSortOrderForUser(user._id),
    });
    return { media: serializeProfileMedia(item, { includeSourceIds: true }), skippedDuplicate: false };
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const duplicate = await ProfileMedia.findOne(filter);
    if (!duplicate) throw error;
    return { media: serializeProfileMedia(duplicate, { includeSourceIds: true }), skippedDuplicate: true };
  }
}

export async function addStoryToProfileMedia({ storyId, user }) {
  if (!["fan", "creator"].includes(user?.role)) throw new ApiError(403, "Profile Media is available to fan and creator accounts");
  if (!mongoose.isValidObjectId(storyId)) throw new ApiError(400, "Invalid story ID");
  const story = await Story.findOne({ _id: storyId });
  if (!story) throw new ApiError(404, "Story no longer available");
  if (String(story.creator) !== String(user._id)) throw new ApiError(403, "You can only add media from your own Story");
  const result = await createSourceProfileMedia({
    mediaPayload: storyProfileMediaPayload(story),
    sourceId: story._id,
    sourceMediaId: SOURCE_MEDIA_ID.story,
    sourceType: "story",
    user,
  });
  return { ...result, storyId: String(story._id) };
}

export function seenMediaCandidatesFromPublication(publication, chapters = []) {
  const candidates = [];
  const seenId = publication?._id || publication?.id;
  const seen = String(seenId || "");
  const seenAssetIds = new Set();
  const add = (sourceMediaId, media, label) => {
    if (!media || !["IMAGE", "VIDEO"].includes(media.mediaType) || !media.assetId || seenAssetIds.has(media.assetId)) return;
    seenAssetIds.add(media.assetId);
    candidates.push({ label, media, sourceMediaId: String(sourceMediaId) });
  };
  add(SOURCE_MEDIA_ID.seenCover, publication?.coverMedia, "Cover");
  for (const chapter of chapters || []) {
    for (const block of chapter.blocks || []) {
      add(block.id, block.media, chapter.title || "Seen media");
    }
  }
  return candidates.map((candidate) => ({
    ...candidate,
    id: `${seen}:${candidate.sourceMediaId}`,
  }));
}

export async function addSeenMediaToProfileMedia({ mediaIds = [], seenId, user }) {
  if (!["fan", "creator"].includes(user?.role)) throw new ApiError(403, "Profile Media is available to fan and creator accounts");
  if (!mongoose.isValidObjectId(seenId)) throw new ApiError(400, "Invalid Seen ID");
  if (!Array.isArray(mediaIds) || !mediaIds.length) throw new ApiError(400, "Choose Seen media to add");
  const publication = await Publication.findOne({ _id: seenId, creator: user._id, kind: "SEEN" });
  if (!publication) throw new ApiError(404, "Seen not found");
  const chapters = await Chapter.find({ publication: publication._id }).sort({ order: 1 }).lean();
  const candidates = seenMediaCandidatesFromPublication(publication, chapters);
  const byId = new Map(candidates.map((candidate) => [candidate.sourceMediaId, candidate]));
  const requestedIds = [...new Set(mediaIds.map((id) => String(id || "").trim()).filter(Boolean))];
  const invalid = requestedIds.filter((id) => !byId.has(id));
  if (invalid.length) throw new ApiError(400, "Selected media does not belong to this Seen or is not supported");
  const added = [];
  const skippedDuplicates = [];
  for (const sourceMediaId of requestedIds) {
    const candidate = byId.get(sourceMediaId);
    const result = await createSourceProfileMedia({
      mediaPayload: profileMediaPayloadFromPublicationMedia(candidate.media),
      sourceId: publication._id,
      sourceMediaId,
      sourceType: "seen",
      user,
    });
    if (result.skippedDuplicate) skippedDuplicates.push(result.media);
    else added.push(result.media);
  }
  return { added, skippedDuplicates, seenId: String(publication._id) };
}
