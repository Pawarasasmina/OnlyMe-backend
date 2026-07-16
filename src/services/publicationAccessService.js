import { publicationDeliveryUrl } from "./publicationMediaStorageService.js";

const plain = (value) => typeof value?.toObject === "function" ? value.toObject() : value;
const safeMedia = (media) => media && ({ mediaType: media.mediaType, format: media.format, width: media.width, height: media.height, duration: media.duration, secureUrl: publicationDeliveryUrl(media) });
const fullChapter = (chapter) => ({ stableChapterId: chapter.stableChapterId, order: chapter.order, title: chapter.title, isPreview: chapter.isPreview, locked: false, blocks: chapter.blocks.map((block) => ({ id: block.id, type: block.type, order: block.order, ...(block.text && { text: block.text }), ...(block.url && { url: block.url, label: block.label }), ...(block.media && { media: safeMedia(block.media) }) })) });
const lockedChapter = (chapter) => ({ stableChapterId: chapter.stableChapterId, order: chapter.order, title: chapter.title, isPreview: false, locked: true, blocks: [] });

export function publicationAccess(publication, viewer) {
  const item = plain(publication); const ownerId = item.creator?._id || item.creator;
  if (viewer?.role === "admin") return "ADMIN";
  if (viewer?._id && String(viewer._id) === String(ownerId)) return "OWNER";
  if (item.status !== "PUBLISHED" || !item.publishedSnapshot) return "NOT_VISIBLE";
  if (item.kind === "SEEN") return "PUBLIC_FULL";
  return "PUBLIC_PREVIEW";
}

export function serializePublication(publication, viewer, { admin = false } = {}) {
  const item = plain(publication); const access = publicationAccess(item, viewer); if (access === "NOT_VISIBLE") return null;
  const snapshot = access === "OWNER" || access === "ADMIN" ? item.submittedSnapshot || item.publishedSnapshot : item.publishedSnapshot;
  const metadata = snapshot?.metadata || item;
  const result = { id: item._id, creator: item.creator?._id ? { id: item.creator._id, name: item.creator.name, username: item.creator.username, avatar: item.creator.avatar } : { id: item.creator }, kind: item.kind, title: metadata.title, summary: metadata.summary, description: metadata.description, category: metadata.category, tags: metadata.tags || [], coverMedia: safeMedia(metadata.coverMedia), status: item.status, pricing: metadata.pricing, planet: metadata.planet, publishedAt: item.publishedAt, access, paymentAvailable: false };
  result.chapters = (snapshot?.chapters || []).map((chapter) => access === "PUBLIC_PREVIEW" && !chapter.isPreview ? lockedChapter(chapter) : fullChapter(chapter));
  result.locked = result.chapters.some((chapter) => chapter.locked);
  if (access === "OWNER" || access === "ADMIN") Object.assign(result, { draftVersion: item.draftVersion, submittedVersion: item.submittedVersion, publishedVersion: item.publishedVersion, statusVersion: item.statusVersion, creatorVisibleFeedback: item.creatorVisibleFeedback, submittedAt: item.submittedAt, reviewedAt: item.reviewedAt });
  if (admin && access === "ADMIN") result.internalModerationNote = item.internalModerationNote || "";
  return result;
}

export const isSeenPlacement = (publication) => publication.kind === "SEEN" && publication.status === "PUBLISHED";
export const isPlanetPlacement = (publication) => ["WORLD", "PREMIUM_WORLD"].includes(publication.kind) && publication.status === "PUBLISHED";
