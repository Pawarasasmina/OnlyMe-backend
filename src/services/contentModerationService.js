import crypto from "node:crypto";
import mongoose from "mongoose";
import Content from "../models/Content.js";
import ContentReviewHistory from "../models/ContentReviewHistory.js";
import Notification from "../models/Notification.js";
import ApiError from "../utils/ApiError.js";

const DECISIONS = {
  APPROVED: { status: "PUBLISHED", notification: "Your content was approved", type: "content_approved" },
  CHANGES_REQUESTED: { status: "CHANGES_REQUESTED", notification: "Changes were requested for your content", type: "content_changes_requested" },
  REJECTED: { status: "REJECTED", notification: "Your content was rejected", type: "content_rejected" },
};
export async function moderateContent({ id, adminId, decision, review = {} }) {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(400, "Invalid content ID"); const config = DECISIONS[decision]; if (!config) throw new ApiError(400, "Unsupported moderation decision");
  if (decision === "APPROVED" && review.manualReviewConfirmed !== true) throw new ApiError(400, "Manual review confirmation is required");
  const message = String(review.creatorVisibleMessage || "").trim();
  if (["CHANGES_REQUESTED", "REJECTED"].includes(decision) && !message) throw new ApiError(400, "A creator-visible message is required");
  if (decision === "REJECTED" && !String(review.rejectionReason || "").trim()) throw new ApiError(400, "A rejection reason is required");
  const transitionId = crypto.randomUUID(); const now = new Date();
  const update = { status: config.status, reviewedAt: now, reviewedBy: adminId, creatorFeedback: message, internalModerationNote: String(review.internalNote || "").trim(), lastTransitionId: transitionId };
  if (config.status === "PUBLISHED") update.publishedAt = now;
  const content = await Content.findOneAndUpdate({ _id: id, status: "PENDING_REVIEW" }, { $set: update, $inc: { statusVersion: 1 } }, { new: true, runValidators: true }).select("+internalModerationNote");
  if (!content) { if (!await Content.exists({ _id: id })) throw new ApiError(404, "Content not found"); throw new ApiError(409, "Content was already reviewed or changed by another admin"); }
  await ContentReviewHistory.create({ content: content._id, creator: content.creator, action: decision, previousStatus: "PENDING_REVIEW", newStatus: config.status, admin: adminId, creatorVisibleMessage: message, internalNote: update.internalModerationNote, reasonCodes: Array.isArray(review.reasonCodes) ? review.reasonCodes : review.rejectionReason ? [String(review.rejectionReason).trim()] : [], transitionId });
  Notification.updateOne({ dedupeKey: transitionId }, { $setOnInsert: { user: content.creator, title: config.notification, type: config.type, dedupeKey: transitionId } }, { upsert: true }).catch(() => {});
  return content;
}
