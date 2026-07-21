export const PUBLICATION_KINDS = ["SEEN", "WORLD", "PREMIUM_WORLD"];
export const PUBLICATION_STATUSES = ["DRAFT", "PENDING_REVIEW", "CHANGES_REQUESTED", "PUBLISHED", "REJECTED", "ARCHIVED", "REMOVED"];
export const ACTIVE_PLANET_STATUSES = ["DRAFT", "PENDING_REVIEW", "CHANGES_REQUESTED", "PUBLISHED"];
export const EDITABLE_PUBLICATION_STATUSES = ["DRAFT", "CHANGES_REQUESTED"];
export const PUBLICATION_ACTIONS = ["DRAFT_CREATED", "DRAFT_UPDATED", "REVISION_STARTED", "REVISION_CANCELED", "CHAPTER_ADDED", "CHAPTER_UPDATED", "CHAPTER_REMOVED", "CHAPTERS_REORDERED", "SUBMITTED", "RESUBMITTED", "APPROVED", "CHANGES_REQUESTED", "REJECTED", "ARCHIVED", "LEGACY_LINKED"];
export const BLOCK_TYPES = ["TEXT", "IMAGE", "VIDEO", "AUDIO", "VOICE", "LINK", "KEY_POINT", "HIGHLIGHT"];
export const TEXT_BLOCK_TYPES = ["TEXT", "KEY_POINT", "HIGHLIGHT"];
export const PREMIUM_PRICE_PRESETS = [90, 190, 290];
export const PUBLICATION_LIMITS = { title: 120, summary: 300, description: 2000, category: 40, tags: 15, tag: 40, chapterTitle: 120, chapterText: 2000, blockLabel: 120 };
export const KIND_RULES = {
  SEEN: { minChapters: 1, maxChapters: 3, pricingMode: "FREE", previewMin: 1, previewMax: 3, placement: "SEEN" },
  WORLD: { minChapters: 2, maxChapters: 10, pricingMode: "ONE_TIME", previewMin: 1, previewMax: 1, placement: "PROFILE_ORBIT" },
  PREMIUM_WORLD: { minChapters: 2, maxChapters: 10, pricingMode: "MONTHLY", previewMin: 1, previewMax: 2, placement: "PROFILE_ORBIT" },
};
