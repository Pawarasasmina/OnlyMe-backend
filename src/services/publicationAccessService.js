import { publicationDeliveryUrl } from "./publicationMediaStorageService.js";
import ProfileRelationship from "../models/ProfileRelationship.js";
import { env } from "../config/env.js";
import { PUBLICATION_VISIBILITIES } from "../constants/publicationConstants.js";

const plain = (value) => typeof value?.toObject === "function" ? value.toObject() : value;
const safeMedia = (media, includeAssetId = false) => media && ({ ...(includeAssetId && { assetId: media.assetId }), mediaType: media.mediaType, resourceType: media.resourceType, format: media.format, bytes: media.bytes, width: media.width, height: media.height, duration: media.duration, secureUrl: publicationDeliveryUrl(media) });
const fullChapter = (chapter, includeAssetId = false) => ({ stableChapterId: chapter.stableChapterId, order: chapter.order, title: chapter.title, isPreview: chapter.isPreview, locked: false, blocks: chapter.blocks.map((block) => ({ id: block.id, type: block.type, order: block.order, ...(block.text && { text: block.text }), ...(block.url && { url: block.url, label: block.label }), ...(block.metadata && { metadata: block.metadata }), ...(block.media && { media: safeMedia(block.media, includeAssetId) }) })) });
const lockedChapter = (chapter, exposeStoryPreviews = false) => ({ stableChapterId: chapter.stableChapterId, order: chapter.order, title: chapter.title, isPreview: false, locked: true, blocks: exposeStoryPreviews ? chapter.blocks.filter((block) => block.metadata?.storyPreview && block.media).map((block) => ({ id: block.id, type: block.type, order: block.order, metadata: block.metadata, media: safeMedia(block.media) })) : [] });
const normalizedVisibility = (value) => PUBLICATION_VISIBILITIES.includes(value) ? value : "PUBLIC";
const idString = (value) => String(value?._id || value || "");
const tokenMatches = (publication, token) => Boolean(token && publication.shareToken && String(token) === String(publication.shareToken));
const legacyPublicVisibility = [{ visibility: "PUBLIC" }, { visibility: { $exists: false } }, { visibility: null }, { visibility: "" }];
const clientBaseUrl = () => String(env.clientUrl || "").replace(/\/+$/u, "");

export async function areMutualFriends(viewerId, creatorId) {
  if (!viewerId || !creatorId || String(viewerId) === String(creatorId)) return false;
  const count = await ProfileRelationship.countDocuments({
    type: "FOLLOW",
    $or: [
      { actor: viewerId, target: creatorId },
      { actor: creatorId, target: viewerId },
    ],
  });
  return count === 2;
}

export async function mutualFriendCreatorIds(viewerId, candidateIds = []) {
  if (!viewerId) return new Set();
  const candidates = [...new Set(candidateIds.map(idString).filter(Boolean).filter((id) => id !== String(viewerId)))];
  const following = await ProfileRelationship.find({ actor: viewerId, ...(candidates.length ? { target: { $in: candidates } } : {}), type: "FOLLOW" }).select("target").lean();
  const followingIds = following.map((row) => row.target);
  if (!followingIds.length) return new Set();
  const followers = await ProfileRelationship.find({ actor: { $in: followingIds }, target: viewerId, type: "FOLLOW" }).select("actor").lean();
  return new Set(followers.map((row) => String(row.actor)));
}

export async function seenVisibilityFilter(viewer, candidateCreatorIds = [], { includeOwner = false } = {}) {
  const viewerId = viewer?._id;
  const filter = [...legacyPublicVisibility];
  if (viewerId) {
    const mutualIds = await mutualFriendCreatorIds(viewerId, candidateCreatorIds);
    if (mutualIds.size) filter.push({ visibility: "FRIENDS", creator: { $in: [...mutualIds] } });
    if (includeOwner) filter.push({ creator: viewerId, visibility: { $ne: "LINK_ONLY" } });
  }
  return { $or: filter };
}

export async function canAccessPublicationAudience(publication, viewer, { shareToken = "" } = {}) {
  const item = plain(publication);
  const ownerId = item.creator?._id || item.creator;
  if (viewer?.role === "admin") return true;
  if (viewer?._id && String(viewer._id) === String(ownerId)) return true;
  const visibility = normalizedVisibility(item.visibility || item.publishedSnapshot?.metadata?.visibility);
  if (visibility === "PUBLIC") return true;
  if (visibility === "LINK_ONLY") return tokenMatches(item, shareToken);
  if (visibility === "FRIENDS") return areMutualFriends(viewer?._id, ownerId);
  return false;
}

function seriesPayload(item, metadata = {}) {
  const series = item.series?.name ? item.series : metadata.series?.name ? metadata.series : null;
  if (!series) return null;
  return { id: String(series._id || series.id), name: series.name };
}

export function publicationAccess(publication, viewer, { audienceAllowed = null, entitlement = null } = {}) {
  const item = plain(publication); const ownerId = item.creator?._id || item.creator;
  if (viewer?.role === "admin") return "ADMIN";
  if (viewer?._id && String(viewer._id) === String(ownerId)) return "OWNER";
  if (item.status === "REMOVED" || !item.publishedSnapshot) return "NOT_VISIBLE";
  if (!["PUBLISHED", "PENDING_REVIEW", "CHANGES_REQUESTED", "REJECTED", "ARCHIVED"].includes(item.status)) return "NOT_VISIBLE";
  if (item.kind === "SEEN") {
    const allowed = audienceAllowed ?? normalizedVisibility(item.visibility || item.publishedSnapshot?.metadata?.visibility) === "PUBLIC";
    return allowed ? "PUBLIC_FULL" : "NOT_VISIBLE";
  }
  if (item.kind === "WORLD") return "PUBLIC_FULL";
  if (item.kind === "PREMIUM_WORLD" && entitlement === "ACTIVE_PREMIUM_MEMBER") return "ACTIVE_PREMIUM_MEMBER";
  if (item.kind === "EXPERIENCE" && ["ENTITLED_EXPERIENCE", "ACTIVE_PREMIUM_MEMBER"].includes(entitlement)) return entitlement;
  if (item.status === "ARCHIVED") return "NOT_VISIBLE";
  return "PUBLIC_PREVIEW";
}

export function serializePublication(publication, viewer, { admin = false, audienceAllowed = null, entitlement = null } = {}) {
  const item = plain(publication); const access = publicationAccess(item, viewer, { audienceAllowed, entitlement }); if (access === "NOT_VISIBLE") return null;
  const snapshot = access === "OWNER" || access === "ADMIN" ? item.submittedSnapshot || item.publishedSnapshot : item.publishedSnapshot;
  const metadata = snapshot?.metadata || item;
  const refs = access === "OWNER" || access === "ADMIN" ? item.entityRefs || metadata.entityRefs || [] : metadata.entityRefs || item.entityRefs || [];
  const visibility = normalizedVisibility(item.visibility || metadata.visibility);
  const result = { id: item._id, creator: item.creator?._id ? { id: item.creator._id, name: item.creator.name, username: item.creator.username, avatar: item.creator.avatar, verified: Boolean(item.creator.isVerified) } : { id: item.creator }, kind: item.kind, title: metadata.title, summary: metadata.summary, description: metadata.description, category: metadata.category, series: seriesPayload(item, metadata), seriesId: seriesPayload(item, metadata)?.id || null, visibility, audience: visibility, tags: metadata.tags || [], attachedEntities: item.attachedEntities || metadata.attachedEntities || [], entityRefs: refs.map((ref) => ({ entityId: String(ref.entityId), entityType: ref.entityType })), coverMedia: safeMedia(metadata.coverMedia), introMedia: safeMedia(metadata.introMedia), replyToSeen: metadata.replyToSeen || item.replyToSeen || null, status: item.status, pricing: metadata.pricing, planet: metadata.planet, includedInWorld: Boolean(metadata.includedInWorld), experiencePath: metadata.experiencePath || "", experienceLocation: metadata.experienceLocation || "", allowDownload: Boolean(metadata.allowDownload), publishedAt: item.publishedAt, access, paymentAvailable: item.kind === "EXPERIENCE" && metadata.pricing?.mode === "ONE_TIME" && access === "PUBLIC_PREVIEW" };
  const canEditMedia = access === "OWNER" || access === "ADMIN";
  result.chapters = (snapshot?.chapters || []).map((chapter) => access === "PUBLIC_PREVIEW" && !chapter.isPreview ? lockedChapter(chapter, item.kind === "EXPERIENCE") : fullChapter(chapter, canEditMedia));
  result.locked = result.chapters.some((chapter) => chapter.locked);
  if ((access === "OWNER" || access === "ADMIN") && visibility === "LINK_ONLY" && item.shareToken) result.shareUrl = `${clientBaseUrl()}/seen/${item._id}?access=${encodeURIComponent(item.shareToken)}`;
  if (access === "OWNER" || access === "ADMIN") Object.assign(result, { draftVersion: item.draftVersion, submittedVersion: item.submittedVersion, publishedVersion: item.publishedVersion, statusVersion: item.statusVersion, creatorVisibleFeedback: item.creatorVisibleFeedback, submittedAt: item.submittedAt, reviewedAt: item.reviewedAt });
  if (admin && access === "ADMIN") result.internalModerationNote = item.internalModerationNote || "";
  return result;
}

export const isSeenPlacement = (publication) => publication.kind === "SEEN" && publication.status === "PUBLISHED" && normalizedVisibility(publication.visibility || publication.publishedSnapshot?.metadata?.visibility) !== "LINK_ONLY";
export const isPlanetPlacement = (publication) => ["WORLD", "PREMIUM_WORLD"].includes(publication.kind) && Boolean(publication.publishedSnapshot) && ["PUBLISHED", "PENDING_REVIEW", "CHANGES_REQUESTED", "REJECTED"].includes(publication.status);
