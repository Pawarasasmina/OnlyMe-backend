import ApiError from "../utils/ApiError.js";
import { ACCESS_LEVELS, CONTENT_LIMITS, CONTENT_TYPES, MEDIA_RULES } from "../constants/contentConstants.js";

const FORBIDDEN = ["status", "reviewedAt", "reviewedBy", "creatorFeedback", "internalModerationNote", "publishedAt", "submittedAt", "archivedAt"];
const text = (value, max, field, required = false) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (required && !normalized) throw new ApiError(400, `${field} is required`);
  if (normalized.length > max) throw new ApiError(400, `${field} cannot exceed ${max} characters`);
  return normalized;
};

export function normalizeContentPayload(payload = {}, { partial = false } = {}) {
  for (const field of FORBIDDEN) if (Object.hasOwn(payload, field)) throw new ApiError(400, `${field} cannot be changed through this endpoint`);
  const result = {};
  if (!partial || Object.hasOwn(payload, "title")) result.title = text(payload.title, CONTENT_LIMITS.title, "Title", !partial);
  if (!partial || Object.hasOwn(payload, "description")) result.description = text(payload.description, CONTENT_LIMITS.description, "Description");
  if (!partial || Object.hasOwn(payload, "body")) result.body = text(payload.body, CONTENT_LIMITS.body, "Body");
  if (!partial || Object.hasOwn(payload, "category")) result.category = text(payload.category, CONTENT_LIMITS.category, "Category", !partial);
  if (!partial || Object.hasOwn(payload, "contentType")) {
    if (!CONTENT_TYPES.includes(payload.contentType)) throw new ApiError(400, "Unsupported content type");
    result.contentType = payload.contentType;
  }
  if (!partial || Object.hasOwn(payload, "accessLevel")) {
    if (!ACCESS_LEVELS.includes(payload.accessLevel)) throw new ApiError(400, "Unsupported access level");
    result.accessLevel = payload.accessLevel;
  }
  if (Object.hasOwn(payload, "coinPrice") || Object.hasOwn(payload, "accessLevel") || !partial) {
    const access = result.accessLevel || payload.accessLevel;
    if (access === "PAY_PER_VIEW") {
      if (!Number.isSafeInteger(payload.coinPrice) || payload.coinPrice < 1) throw new ApiError(400, "Pay-per-view coin price must be a positive integer");
      result.coinPrice = payload.coinPrice;
    } else {
      if (payload.coinPrice != null) throw new ApiError(400, "Coin price must be null unless access is pay-per-view");
      result.coinPrice = null;
    }
  }
  if (!partial || Object.hasOwn(payload, "tags")) {
    if (!Array.isArray(payload.tags || [])) throw new ApiError(400, "Tags must be an array");
    const tags = [...new Set((payload.tags || []).map((tag) => text(tag, CONTENT_LIMITS.tag, "Tag").toLowerCase()).filter(Boolean))];
    if (tags.length > CONTENT_LIMITS.tags) throw new ApiError(400, `A maximum of ${CONTENT_LIMITS.tags} tags is allowed`);
    result.tags = tags;
  }
  if (Object.hasOwn(payload, "media")) {
    if (!Array.isArray(payload.media)) throw new ApiError(400, "Media must be an array");
    result.media = payload.media;
  }
  if (Object.hasOwn(payload, "thumbnail")) result.thumbnail = payload.thumbnail || undefined;
  return result;
}

export function assertContentComplete(content) {
  text(content.title, CONTENT_LIMITS.title, "Title", true);
  text(content.category, CONTENT_LIMITS.category, "Category", true);
  if (!CONTENT_TYPES.includes(content.contentType)) throw new ApiError(400, "Unsupported content type");
  if (!ACCESS_LEVELS.includes(content.accessLevel)) throw new ApiError(400, "Unsupported access level");
  if (content.accessLevel === "PAY_PER_VIEW" && (!Number.isSafeInteger(content.coinPrice) || content.coinPrice < 1)) throw new ApiError(400, "Pay-per-view coin price is required");
  if (content.accessLevel !== "PAY_PER_VIEW" && content.coinPrice != null) throw new ApiError(400, "Coin price must be null for this access level");
  if (content.contentType === "TEXT") {
    text(content.body, CONTENT_LIMITS.body, "Body", true);
    if (content.media?.length) throw new ApiError(400, "Text posts cannot contain media");
    return;
  }
  const rule = MEDIA_RULES[content.contentType];
  const media = content.media || [];
  if (media.length < rule.min || media.length > rule.max) throw new ApiError(400, `${content.contentType} posts require ${rule.min === rule.max ? rule.min : `${rule.min}-${rule.max}`} media asset(s)`);
  if (media.some((item) => item.mediaType !== content.contentType || item.resourceType !== rule.resourceType || !rule.formats.includes(String(item.format).toLowerCase()))) throw new ApiError(400, "Media type or format does not match the post type");
  if (content.contentType === "IMAGE" && media.filter((item) => item.isPrimary).length !== 1) throw new ApiError(400, "Image posts require exactly one primary image");
  if (new Set(media.map((item) => item.assetId)).size !== media.length) throw new ApiError(400, "Duplicate media assets are not allowed");
}

// Legacy export retained for callers during rollout; direct publishing is disabled.
export const validateContentPayload = (payload) => normalizeContentPayload(payload);
