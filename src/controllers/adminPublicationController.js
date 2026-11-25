import Publication from "../models/Publication.js";
import PublicationReviewHistory from "../models/PublicationReviewHistory.js";
import { serializePublication } from "../services/publicationAccessService.js";
import { moderatePublication } from "../services/publicationModerationService.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

const worldKinds = ["WORLD", "PREMIUM_WORLD"];
const paidSeenFilter = { kind: "SEEN", $or: [{ "pricing.mode": "ONE_TIME" }, { "submittedSnapshot.metadata.pricing.mode": "ONE_TIME" }, { "publishedSnapshot.metadata.pricing.mode": "ONE_TIME" }] };
const reviewFilter = (scope, id) => ({ ...(id ? { _id: id } : {}), ...(scope === "PAID_SEEN" ? paidSeenFilter : scope === "WORLD" ? { kind: { $in: worldKinds } } : { $or: [{ kind: { $in: worldKinds } }, paidSeenFilter] }) });

const comparable = (value) => JSON.stringify(value ?? null);
const mediaKey = (media) => media?.assetId || media?.secureUrl || null;
const revisionChanges = (publication) => {
  const previous = publication.publishedSnapshot;
  if (!previous) return [];
  const submitted = publication.submittedSnapshot || {};
  const before = previous.metadata || {};
  const after = submitted.metadata || {};
  const changes = [];
  const add = (field, label, oldValue, newValue) => {
    if (comparable(oldValue) !== comparable(newValue)) changes.push({ field, label, before: oldValue ?? null, after: newValue ?? null });
  };
  add("title", "World name", before.title, after.title);
  add("description", "Description", before.description || before.summary, after.description || after.summary);
  add("coverMedia", "Cover media", mediaKey(before.coverMedia), mediaKey(after.coverMedia));
  add("planet", "World appearance", before.planet, after.planet);
  add("pricing", "Membership price", before.pricing, after.pricing);
  add("ownerWelcomeNote", "Welcome message", before.ownerWelcomeNote, after.ownerWelcomeNote);
  add("worldWelcomeVoiceMedia", "Welcome voice", mediaKey(before.worldWelcomeVoiceMedia), mediaKey(after.worldWelcomeVoiceMedia));
  add("includedExperienceIds", "Attached paid Seens", (before.includedExperienceIds || []).map(String).sort(), (after.includedExperienceIds || []).map(String).sort());
  const oldChapters = new Map((previous.chapters || []).map((chapter) => [String(chapter.stableChapterId), chapter]));
  const newChapters = new Map((submitted.chapters || []).map((chapter) => [String(chapter.stableChapterId), chapter]));
  for (const [id, chapter] of newChapters) {
    if (!oldChapters.has(id)) changes.push({ field: `chapter:${id}`, label: `Chapter added: ${chapter.title || "Untitled chapter"}`, type: "ADDED" });
    else if (comparable(oldChapters.get(id)) !== comparable(chapter)) changes.push({ field: `chapter:${id}`, label: `Chapter changed: ${chapter.title || "Untitled chapter"}`, type: "UPDATED" });
  }
  for (const [id, chapter] of oldChapters) if (!newChapters.has(id)) changes.push({ field: `chapter:${id}`, label: `Chapter removed: ${chapter.title || "Untitled chapter"}`, type: "REMOVED" });
  return changes;
};

export const listModeration = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const scope = String(req.query.scope || "ALL").toUpperCase();
  if (!["ALL", "WORLD", "PAID_SEEN"].includes(scope)) throw new ApiError(400, "Choose a valid review queue");
  const filter = { ...reviewFilter(scope), ...(req.query.status ? { status: req.query.status } : {}) };
  const [items, total] = await Promise.all([
    Publication.find(filter).select("+submittedSnapshot +internalModerationNote").populate("creator", "name username email avatar creatorApprovalStatus status").sort({ submittedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Publication.countDocuments(filter),
  ]);
  return sendResponse(res, 200, "Publication approval queue fetched", { items: items.map((item) => serializePublication(item, req.user, { admin: true })), pagination: { page, limit, total } });
});

export const getModeration = asyncHandler(async (req, res) => {
  const publication = await Publication.findOne(reviewFilter("ALL", req.params.id)).select("+submittedSnapshot +internalModerationNote").populate("creator", "name username email avatar creatorApprovalStatus status").lean();
  if (!publication) throw new ApiError(404, "Reviewable publication not found");
  const includedIds = (publication.submittedSnapshot?.metadata?.includedExperienceIds || publication.includedExperienceIds || []).map(String);
  const [history, includedPaidSeens] = await Promise.all([
    PublicationReviewHistory.find({ publication: publication._id, action: { $nin: ["DRAFT_UPDATED", "CHAPTER_UPDATED"] } }).sort({ createdAt: 1 }).populate("admin", "name username email").lean(),
    includedIds.length ? Publication.find({ _id: { $in: includedIds }, kind: "SEEN" }).select("title summary coverMedia pricing status publishedSnapshot submittedSnapshot").lean() : [],
  ]);
  const byId = new Map(includedPaidSeens.map((item) => [String(item._id), item]));
  const attachedPaidSeens = includedIds.map((id) => byId.get(id)).filter(Boolean).map((item) => {
    const snapshot = item.publishedSnapshot || item.submittedSnapshot;
    const metadata = snapshot?.metadata || item;
    return { id: String(item._id), title: metadata.title || item.title, summary: metadata.summary || item.summary || "", coverMedia: metadata.coverMedia || item.coverMedia || null, pricing: metadata.pricing || item.pricing, status: item.status, chapterCount: snapshot?.chapters?.length || 0 };
  });
  return sendResponse(res, 200, "World approval detail fetched", { publication: serializePublication(publication, req.user, { admin: true }), history, reviewContext: { isRevision: Boolean(publication.publishedSnapshot), changes: revisionChanges(publication), attachedPaidSeens } });
});

export const getHistory = asyncHandler(async (req, res) => {
  if (!await Publication.exists(reviewFilter("ALL", req.params.id))) throw new ApiError(404, "Reviewable publication not found");
  return sendResponse(res, 200, "World approval history fetched", { history: await PublicationReviewHistory.find({ publication: req.params.id, action: { $nin: ["DRAFT_UPDATED", "CHAPTER_UPDATED"] } }).sort({ createdAt: 1 }).lean() });
});
const decide = (decision) => asyncHandler(async (req, res) => sendResponse(res, 200, `Publication ${decision.toLowerCase()}`, { publication: serializePublication(await moderatePublication({ id: req.params.id, adminId: req.user._id, decision, review: req.body }), req.user, { admin: true }) }));
export const approve = decide("APPROVED"); export const requestChanges = decide("CHANGES_REQUESTED"); export const reject = decide("REJECTED");
