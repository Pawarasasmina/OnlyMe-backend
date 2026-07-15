const creatorSummary = (creator) => creator && ({ id: creator._id, name: creator.name, username: creator.username, avatar: creator.avatar });
const plain = (content) => typeof content.toObject === "function" ? content.toObject() : content;

export function resolveContentAccess(content, viewer) {
  const ownerId = content.creator?._id || content.creator;
  if (viewer?.role === "admin") return "ADMIN";
  if (viewer?._id && String(viewer._id) === String(ownerId)) return "OWNER";
  if (content.status === "PUBLISHED" && content.accessLevel === "PUBLIC") return "PUBLIC";
  return "LOCKED";
}

export function serializeContent(content, viewer, { admin = false } = {}) {
  const item = plain(content); const access = resolveContentAccess(item, viewer);
  const base = { id: item._id, creator: creatorSummary(item.creator), title: item.title, description: item.description, contentType: item.contentType, category: item.category, tags: item.tags || [], accessLevel: item.accessLevel, coinPrice: item.coinPrice, status: item.status, publishedAt: item.publishedAt, createdAt: item.createdAt, locked: access === "LOCKED" };
  if (access === "LOCKED") return { ...base, thumbnail: null };
  const media = (item.media || []).map((entry) => ({ ...entry, secureUrl: authenticatedDeliveryUrl(entry) }));
  const thumbnail = item.thumbnail ? { ...item.thumbnail, secureUrl: authenticatedDeliveryUrl(item.thumbnail) } : undefined;
  const result = { ...base, body: item.body, media, thumbnail, creatorFeedback: item.creatorFeedback, submittedAt: item.submittedAt, reviewedAt: item.reviewedAt, archivedAt: item.archivedAt, statusVersion: item.statusVersion };
  if (admin) { result.internalModerationNote = item.internalModerationNote || ""; result.reviewedBy = item.reviewedBy; result.legacyMigration = item.legacyMigration; result.stateSyncPending = item.stateSyncPending; result.creator = item.creator && { id: item.creator._id, name: item.creator.name, username: item.creator.username, email: item.creator.email, avatar: item.creator.avatar, status: item.creator.status, creatorApprovalStatus: item.creator.creatorApprovalStatus }; }
  return result;
}
import { authenticatedDeliveryUrl } from "./contentMediaStorageService.js";
