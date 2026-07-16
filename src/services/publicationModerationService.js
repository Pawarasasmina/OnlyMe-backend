import crypto from "node:crypto";
import mongoose from "mongoose";
import Notification from "../models/Notification.js";
import Publication from "../models/Publication.js";
import PublicationReviewHistory from "../models/PublicationReviewHistory.js";
import ApiError from "../utils/ApiError.js";

const decisions = { APPROVED: { status: "PUBLISHED", title: "Your publication was approved", type: "publication_approved" }, CHANGES_REQUESTED: { status: "CHANGES_REQUESTED", title: "Changes were requested for your publication", type: "publication_changes_requested" }, REJECTED: { status: "REJECTED", title: "Your publication was rejected", type: "publication_rejected" } };

export async function moderatePublication({ adminId, decision, id, review = {} }) {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(400, "Invalid publication ID"); const config = decisions[decision]; if (!config) throw new ApiError(400, "Unsupported moderation decision");
  if (decision === "APPROVED" && review.manualReviewConfirmed !== true) throw new ApiError(400, "Manual review confirmation is required");
  const message = String(review.creatorVisibleMessage || "").trim(); if (["CHANGES_REQUESTED", "REJECTED"].includes(decision) && !message) throw new ApiError(400, "A creator-visible message is required");
  if (decision === "REJECTED" && !String(review.rejectionReason || "").trim()) throw new ApiError(400, "A rejection reason is required");
  const transitionId = crypto.randomUUID(); const now = new Date();
  const current = await Publication.findOne({ _id: id, status: "PENDING_REVIEW" }).select("+submittedSnapshot"); if (!current) { if (!await Publication.exists({ _id: id })) throw new ApiError(404, "Publication not found"); throw new ApiError(409, "Publication was already reviewed or changed"); }
  const set = { status: config.status, reviewedAt: now, reviewedBy: adminId, creatorVisibleFeedback: message, internalModerationNote: String(review.internalNote || "").trim(), lastTransitionId: transitionId };
  if (decision === "APPROVED") Object.assign(set, { publishedAt: now, publishedVersion: current.submittedVersion, publishedSnapshot: current.submittedSnapshot });
  const publication = await Publication.findOneAndUpdate({ _id: id, status: "PENDING_REVIEW", statusVersion: current.statusVersion, submittedVersion: current.submittedVersion }, { $set: set, $inc: { statusVersion: 1 } }, { new: true }).select("+submittedSnapshot +internalModerationNote");
  if (!publication) throw new ApiError(409, "Publication was reviewed concurrently");
  await PublicationReviewHistory.create({ publication: publication._id, creator: publication.creator, action: decision, previousStatus: "PENDING_REVIEW", newStatus: config.status, revisionVersion: current.submittedVersion, admin: adminId, creatorVisibleMessage: message, internalNote: set.internalModerationNote, reasonCodes: Array.isArray(review.reasonCodes) ? review.reasonCodes : review.rejectionReason ? [String(review.rejectionReason)] : [], transitionId });
  Notification.updateOne({ dedupeKey: transitionId }, { $setOnInsert: { user: publication.creator, title: config.title, type: config.type, dedupeKey: transitionId } }, { upsert: true }).catch(() => {});
  return publication;
}
