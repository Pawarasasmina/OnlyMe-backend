import crypto from "node:crypto";
import ApiError from "../utils/ApiError.js";
import { BLOCK_TYPES, KIND_RULES, PREMIUM_PRICE_PRESETS, PUBLICATION_KINDS, PUBLICATION_LIMITS, TEXT_BLOCK_TYPES } from "../constants/publicationConstants.js";

const text = (value, max, name, required = false) => { const result = typeof value === "string" ? value.trim() : ""; if (required && !result) throw new ApiError(400, `${name} is required`); if (result.length > max) throw new ApiError(400, `${name} cannot exceed ${max} characters`); return result; };
const safeUrl = (value) => { try { const url = new URL(String(value)); if (!["http:", "https:"].includes(url.protocol)) throw new Error(); return url.toString(); } catch { throw new ApiError(400, "Links must use http or https"); } };

export function derivedPublicationPolicy(kind) {
  if (!PUBLICATION_KINDS.includes(kind)) throw new ApiError(400, "Unsupported publication kind");
  return kind === "SEEN" ? { pricing: { mode: "FREE", starsAmount: null, presetId: null }, previewPolicy: "ALL_FREE", placement: "SEEN" } : kind === "WORLD" ? { previewPolicy: "ONE_CHAPTER", placement: "PROFILE_ORBIT" } : { previewPolicy: "ONE_OR_TWO_CHAPTERS", placement: "PROFILE_ORBIT" };
}

export function normalizePublicationDraft(payload = {}, { partial = false } = {}) {
  for (const field of ["status", "creator", "submittedSnapshot", "publishedSnapshot", "submittedVersion", "publishedVersion", "reviewedBy", "internalModerationNote", "placement"]) if (Object.hasOwn(payload, field)) throw new ApiError(400, `${field} cannot be changed`);
  const result = {};
  if (!partial || Object.hasOwn(payload, "kind")) { if (!PUBLICATION_KINDS.includes(payload.kind)) throw new ApiError(400, "Unsupported publication kind"); result.kind = payload.kind; }
  for (const [field, max] of [["title", PUBLICATION_LIMITS.title], ["summary", PUBLICATION_LIMITS.summary], ["description", PUBLICATION_LIMITS.description], ["category", PUBLICATION_LIMITS.category]]) if (!partial || Object.hasOwn(payload, field)) result[field] = text(payload[field], max, field);
  if (!partial || Object.hasOwn(payload, "tags")) { if (!Array.isArray(payload.tags || [])) throw new ApiError(400, "Tags must be an array"); result.tags = [...new Set((payload.tags || []).map((tag) => text(tag, PUBLICATION_LIMITS.tag, "tag").toLowerCase()).filter(Boolean))]; if (result.tags.length > PUBLICATION_LIMITS.tags) throw new ApiError(400, "Too many tags"); }
  if (Object.hasOwn(payload, "pricing")) result.pricing = payload.pricing;
  if (Object.hasOwn(payload, "planet")) result.planet = { emoji: text(payload.planet?.emoji, 16, "planet emoji"), accent: text(payload.planet?.accent, 40, "planet accent") };
  return result;
}

export function normalizeBlocks(blocks = []) {
  if (!Array.isArray(blocks)) throw new ApiError(400, "Blocks must be an array");
  const ids = new Set(); let textualCharacters = 0;
  const normalized = blocks.map((block, order) => {
    if (!BLOCK_TYPES.includes(block.type)) throw new ApiError(400, "Unsupported block type");
    const id = text(block.id, 80, "Block ID") || crypto.randomUUID(); if (ids.has(id)) throw new ApiError(400, "Block IDs must be unique"); ids.add(id);
    const item = { id, type: block.type, order };
    if (TEXT_BLOCK_TYPES.includes(block.type)) { item.text = text(block.text, PUBLICATION_LIMITS.chapterText, "Block text", true); textualCharacters += item.text.length; }
    if (block.type === "LINK") { item.url = safeUrl(block.url); item.label = text(block.label, PUBLICATION_LIMITS.blockLabel, "Link label", true); textualCharacters += item.label.length; }
    if (["IMAGE", "VIDEO", "AUDIO", "VOICE"].includes(block.type)) { if (!block.media?.assetId) throw new ApiError(400, "Verified media is required"); item.media = block.media; }
    return item;
  });
  if (textualCharacters > PUBLICATION_LIMITS.chapterText) throw new ApiError(400, "Chapter text cannot exceed 2000 characters");
  return normalized;
}

export function normalizeChapter(payload = {}) { return { title: text(payload.title, PUBLICATION_LIMITS.chapterTitle, "Chapter title", true), blocks: normalizeBlocks(payload.blocks || []), isPreview: Boolean(payload.isPreview), releaseMode: payload.releaseMode === "SCHEDULED" ? "SCHEDULED" : "IMMEDIATE", releaseAt: payload.releaseMode === "SCHEDULED" ? new Date(payload.releaseAt) : null }; }

export function assertCompletePublication(publication, chapters) {
  const policy = derivedPublicationPolicy(publication.kind); const rules = KIND_RULES[publication.kind];
  text(publication.title, PUBLICATION_LIMITS.title, "Title", true); text(publication.summary, PUBLICATION_LIMITS.summary, "Summary", true); text(publication.category, PUBLICATION_LIMITS.category, "Category", true);
  if (!publication.coverMedia?.assetId) throw new ApiError(400, "A verified cover image is required");
  if (chapters.length < rules.minChapters || chapters.length > rules.maxChapters) throw new ApiError(400, `${publication.kind} requires ${rules.minChapters}-${rules.maxChapters} chapters`);
  chapters.forEach((chapter) => normalizeChapter(chapter));
  const previews = chapters.filter((chapter) => chapter.isPreview).length;
  if (publication.kind === "SEEN") { if (publication.pricing?.mode !== "FREE" || publication.pricing?.starsAmount != null) throw new ApiError(400, "Seen must be free"); if (previews !== chapters.length) throw new ApiError(400, "Every Seen chapter must be public"); }
  if (publication.kind === "WORLD") { if (publication.pricing?.mode !== "ONE_TIME" || !Number.isSafeInteger(publication.pricing?.starsAmount) || publication.pricing.starsAmount < 1) throw new ApiError(400, "World requires a positive one-time Stars price"); if (previews !== 1) throw new ApiError(400, "World requires exactly one preview chapter"); }
  if (publication.kind === "PREMIUM_WORLD") { if (publication.pricing?.mode !== "MONTHLY" || !PREMIUM_PRICE_PRESETS.includes(publication.pricing?.starsAmount)) throw new ApiError(400, "Premium World price must be 90, 190, or 290 Stars"); if (previews < 1 || previews > 2 || previews === chapters.length) throw new ApiError(400, "Premium World requires 1-2 previews and at least one locked chapter"); }
  return policy;
}
