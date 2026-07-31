export const CONTENT_TYPES = ["IMAGE", "VIDEO", "AUDIO", "TEXT"];
export const ACCESS_LEVELS = ["PUBLIC", "SUBSCRIBER_ONLY", "PAY_PER_VIEW"];
export const CONTENT_STATUSES = ["DRAFT", "UPLOADING", "PROCESSING", "PENDING_REVIEW", "CHANGES_REQUESTED", "SCHEDULED", "PUBLISHED", "REJECTED", "ARCHIVED", "REMOVED"];
export const CONTENT_ACTIONS = ["DRAFT_CREATED", "DRAFT_UPDATED", "SUBMITTED", "RESUBMITTED", "CHANGES_REQUESTED", "APPROVED", "REJECTED", "ARCHIVED", "LEGACY_MIGRATED"];
export const EDITABLE_CONTENT_STATUSES = ["DRAFT", "CHANGES_REQUESTED"];
export const ARCHIVABLE_CONTENT_STATUSES = ["DRAFT", "CHANGES_REQUESTED", "REJECTED", "PUBLISHED"];
export const MEDIA_RULES = {
  IMAGE: { resourceType: "image", min: 1, max: 10, formats: ["jpg", "jpeg", "png", "webp"] },
  VIDEO: { resourceType: "video", min: 1, max: 1, formats: ["mp4", "mov"] },
  AUDIO: { resourceType: "video", min: 1, max: 1, formats: ["mp3", "wav", "aac", "flac"] },
};
export const CONTENT_LIMITS = { title: 120, description: 2000, body: 10000, category: 40, tags: 15, tag: 40 };
