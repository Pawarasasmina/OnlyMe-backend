import mongoose from "mongoose";
import Content from "../models/Content.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { serializeContent } from "../services/contentAccessService.js";
import { archiveContent, createDraft, resubmitContent, submitDraft, updateDraft } from "../services/contentService.js";
import { uploadContentFile } from "../services/contentMediaStorageService.js";
import { ACCESS_LEVELS, CONTENT_STATUSES, CONTENT_TYPES } from "../constants/contentConstants.js";
import { env } from "../config/env.js";

const pageOptions = (req) => ({ page: Math.max(1, Number(req.query.page) || 1), limit: Math.min(50, Math.max(1, Number(req.query.limit) || 20)) });
export const listContent = asyncHandler(async (req, res) => {
  const { page, limit } = pageOptions(req); const filter = { status: { $in: ["PUBLISHED", "published"] } };
  if (req.params.creatorId) { if (!mongoose.isValidObjectId(req.params.creatorId)) throw new ApiError(400, "Invalid creator ID"); filter.creator = req.params.creatorId; }
  const [records, total] = await Promise.all([Content.find(filter).sort({ publishedAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).populate("creator", "name username avatar").lean(), Content.countDocuments(filter)]);
  return sendResponse(res, 200, "Published content fetched", { items: records.map((item) => serializeContent(item, null)), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});
export const listMyContent = asyncHandler(async (req, res) => {
  const { page, limit } = pageOptions(req); const filter = { creator: req.user._id };
  if (CONTENT_STATUSES.includes(req.query.status)) filter.status = req.query.status;
  if (CONTENT_TYPES.includes(req.query.contentType)) filter.contentType = req.query.contentType;
  if (ACCESS_LEVELS.includes(req.query.accessLevel)) filter.accessLevel = req.query.accessLevel;
  if (String(req.query.search || "").trim()) filter.title = { $regex: String(req.query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  const [records, total] = await Promise.all([Content.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), Content.countDocuments(filter)]);
  return sendResponse(res, 200, "Creator content fetched", { items: records.map((item) => serializeContent(item, req.user)), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});
export const getMyContent = asyncHandler(async (req, res) => { const item = await Content.findOne({ _id: req.params.id, creator: req.user._id }).lean(); if (!item) throw new ApiError(404, "Content not found"); return sendResponse(res, 200, "Content fetched", { content: serializeContent(item, req.user) }); });
export const createContentDraft = asyncHandler(async (req, res) => sendResponse(res, 201, "Draft created", { content: serializeContent(await createDraft(req.user._id, req.body), req.user) }));
export const updateContentDraft = asyncHandler(async (req, res) => sendResponse(res, 200, "Content updated", { content: serializeContent(await updateDraft(req.user._id, req.params.id, req.body), req.user) }));
export const submitContent = asyncHandler(async (req, res) => sendResponse(res, 200, "Content submitted for review", { content: serializeContent(await submitDraft(req.user._id, req.params.id), req.user) }));
export const resubmitForReview = asyncHandler(async (req, res) => sendResponse(res, 200, "Content resubmitted for review", { content: serializeContent(await resubmitContent(req.user._id, req.params.id), req.user) }));
export const archiveMyContent = asyncHandler(async (req, res) => sendResponse(res, 200, "Content archived", { content: serializeContent(await archiveContent(req.user._id, req.params.id), req.user) }));
export const getUploadSignature = asyncHandler(async (req, res) => { const content = await Content.findOne({ _id: req.body.contentId, creator: req.user._id }); if (!content) throw new ApiError(404, "Draft not found"); if (!["DRAFT", "CHANGES_REQUESTED"].includes(content.status)) throw new ApiError(409, "Uploads are not allowed in the current status"); return sendResponse(res, 200, "Content upload contract created", { contentId: content._id, maxFileSize: env.contentMaxFileSize, uploadUrl: `/content/${content._id}/media-upload` }); });
export const uploadDraftMedia = asyncHandler(async (req, res) => { const content = await Content.findOne({ _id: req.params.id, creator: req.user._id }); if (!content) throw new ApiError(404, "Draft not found"); if (!["DRAFT", "CHANGES_REQUESTED"].includes(content.status)) throw new ApiError(409, "Uploads are not allowed in the current status"); const asset = await uploadContentFile({ file: req.file, creatorId: req.user._id, contentId: content._id, contentType: content.contentType }); return sendResponse(res, 201, "Content media uploaded", asset); });
export const publishImageContent = asyncHandler(async (_req, _res) => { throw new ApiError(410, "Direct publishing is disabled. Create a draft and submit it for manual review."); });
