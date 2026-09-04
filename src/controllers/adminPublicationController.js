import Publication from "../models/Publication.js";
import PublicationReviewHistory from "../models/PublicationReviewHistory.js";
import { serializePublication } from "../services/publicationAccessService.js";
import { moderatePublication } from "../services/publicationModerationService.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

const planetKinds = ["WORLD", "PREMIUM_WORLD"];
const planetFilter = (id) => ({ ...(id ? { _id: id } : {}), kind: { $in: planetKinds } });

export const listModeration = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const filter = { ...planetFilter(), ...(req.query.status ? { status: req.query.status } : {}) };
  const [items, total] = await Promise.all([
    Publication.find(filter).select("+submittedSnapshot +internalModerationNote").populate("creator", "name username email avatar creatorApprovalStatus status").sort({ submittedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Publication.countDocuments(filter),
  ]);
  return sendResponse(res, 200, "Planet approval queue fetched", { items: items.map((item) => serializePublication(item, req.user, { admin: true })), pagination: { page, limit, total } });
});

export const getModeration = asyncHandler(async (req, res) => {
  const publication = await Publication.findOne(planetFilter(req.params.id)).select("+submittedSnapshot +internalModerationNote").populate("creator", "name username email avatar creatorApprovalStatus status").lean();
  if (!publication) throw new ApiError(404, "Planet not found");
  const history = await PublicationReviewHistory.find({ publication: publication._id, action: { $nin: ["DRAFT_UPDATED", "CHAPTER_UPDATED"] } }).sort({ createdAt: 1 }).populate("admin", "name username email").lean();
  return sendResponse(res, 200, "Planet approval detail fetched", { publication: serializePublication(publication, req.user, { admin: true }), history });
});

export const getHistory = asyncHandler(async (req, res) => {
  if (!await Publication.exists(planetFilter(req.params.id))) throw new ApiError(404, "Planet not found");
  return sendResponse(res, 200, "Planet approval history fetched", { history: await PublicationReviewHistory.find({ publication: req.params.id, action: { $nin: ["DRAFT_UPDATED", "CHAPTER_UPDATED"] } }).sort({ createdAt: 1 }).lean() });
});
const decide = (decision) => asyncHandler(async (req, res) => sendResponse(res, 200, `Publication ${decision.toLowerCase()}`, { publication: serializePublication(await moderatePublication({ id: req.params.id, adminId: req.user._id, decision, review: req.body }), req.user, { admin: true }) }));
export const approve = decide("APPROVED"); export const requestChanges = decide("CHANGES_REQUESTED"); export const reject = decide("REJECTED");
