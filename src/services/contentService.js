import crypto from "node:crypto";
import mongoose from "mongoose";
import Content from "../models/Content.js";
import ContentReviewHistory from "../models/ContentReviewHistory.js";
import ApiError from "../utils/ApiError.js";
import { ARCHIVABLE_CONTENT_STATUSES, EDITABLE_CONTENT_STATUSES } from "../constants/contentConstants.js";
import { assertContentComplete, normalizeContentPayload } from "../validators/contentValidator.js";
import { verifyMediaPayload } from "./contentMediaStorageService.js";

const history = (content, action, previousStatus, transitionId, extra = {}) => ContentReviewHistory.create({ content: content._id, creator: content.creator, action, previousStatus, newStatus: content.status, transitionId, ...extra });
export async function createDraft(creatorId, payload) {
  const normalized = normalizeContentPayload(payload); const id = new mongoose.Types.ObjectId();
  if (normalized.media?.length) normalized.media = await verifyMediaPayload({ media: normalized.media, creatorId, contentId: id, contentType: normalized.contentType });
  const content = await Content.create({ _id: id, creator: creatorId, ...normalized, status: "DRAFT" });
  await history(content, "DRAFT_CREATED", "DRAFT", crypto.randomUUID()); return content;
}
export async function updateDraft(creatorId, id, payload) {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(400, "Invalid content ID");
  const current = await Content.findOne({ _id: id, creator: creatorId }); if (!current) throw new ApiError(404, "Content not found");
  if (!EDITABLE_CONTENT_STATUSES.includes(current.status)) throw new ApiError(409, "Content cannot be edited in its current status");
  const normalized = normalizeContentPayload(payload, { partial: true });
  if (normalized.media) normalized.media = await verifyMediaPayload({ media: normalized.media, creatorId, contentId: id, contentType: normalized.contentType || current.contentType });
  const expectedVersion = payload.statusVersion ?? current.statusVersion;
  const updated = await Content.findOneAndUpdate({ _id: id, creator: creatorId, status: current.status, statusVersion: expectedVersion }, { $set: normalized, $inc: { statusVersion: 1 } }, { new: true, runValidators: true });
  if (!updated) throw new ApiError(409, "Content changed while it was being edited");
  await history(updated, "DRAFT_UPDATED", current.status, crypto.randomUUID()); return updated;
}
async function submit(creatorId, id, expectedStatus, action) {
  const current = await Content.findOne({ _id: id, creator: creatorId }); if (!current) throw new ApiError(404, "Content not found");
  if (current.status !== expectedStatus) throw new ApiError(409, `Content must be ${expectedStatus} to submit`); assertContentComplete(current);
  const transitionId = crypto.randomUUID();
  const updated = await Content.findOneAndUpdate({ _id: id, creator: creatorId, status: expectedStatus, statusVersion: current.statusVersion }, { $set: { status: "PENDING_REVIEW", submittedAt: new Date(), creatorFeedback: "", lastTransitionId: transitionId }, $inc: { statusVersion: 1 } }, { new: true, runValidators: true });
  if (!updated) throw new ApiError(409, "Content was already submitted or changed");
  await history(updated, action, expectedStatus, transitionId); return updated;
}
export const submitDraft = (creatorId, id) => submit(creatorId, id, "DRAFT", "SUBMITTED");
export const resubmitContent = (creatorId, id) => submit(creatorId, id, "CHANGES_REQUESTED", "RESUBMITTED");
export async function archiveContent(creatorId, id) {
  const current = await Content.findOne({ _id: id, creator: creatorId }); if (!current) throw new ApiError(404, "Content not found");
  if (!ARCHIVABLE_CONTENT_STATUSES.includes(current.status)) throw new ApiError(409, "Content cannot be archived in its current status");
  const transitionId = crypto.randomUUID();
  const updated = await Content.findOneAndUpdate({ _id: id, creator: creatorId, status: current.status, statusVersion: current.statusVersion }, { $set: { status: "ARCHIVED", archivedAt: new Date(), lastTransitionId: transitionId }, $inc: { statusVersion: 1 } }, { new: true });
  if (!updated) throw new ApiError(409, "Content changed before it could be archived"); await history(updated, "ARCHIVED", current.status, transitionId); return updated;
}
