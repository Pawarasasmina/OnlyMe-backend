import crypto from "node:crypto";
import mongoose from "mongoose";
import CreatorProfile from "../models/CreatorProfile.js";
import CreatorVerification from "../models/CreatorVerification.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import VerificationReviewHistory from "../models/VerificationReviewHistory.js";
import ApiError from "../utils/ApiError.js";
import { assertCompleteApplication } from "../validators/verificationValidator.js";
import { claimAtomicStatusTransition } from "./atomicStatusTransitionService.js";

const unsupportedTransaction = (error) => /Transaction numbers are only allowed|does not support transactions|replica set/i.test(error.message || "");
const options = (session) => session ? { session } : {};

export const DECISIONS = {
  APPROVED: { approval: "approved", verified: true, profile: "verified", action: "APPROVED", notification: "Your creator verification was approved", notificationType: "verification_approved" },
  CHANGES_REQUESTED: { approval: "pending", verified: false, profile: "pending", action: "CHANGES_REQUESTED", notification: "Changes were requested for your creator verification", notificationType: "verification_changes_requested" },
  REJECTED: { approval: "rejected", verified: false, profile: "rejected", action: "REJECTED", notification: "Your creator verification was rejected", notificationType: "verification_rejected" },
};

async function claimDecision({ id, targetStatus, adminId, review, transitionId, session }) {
  let claimed;
  try {
    claimed = await claimAtomicStatusTransition({
      repository: CreatorVerification,
      id,
      expectedStatus: "PENDING_REVIEW",
      targetStatus,
      update: {
        reviewedAt: new Date(),
        reviewedBy: adminId,
        adminInternalNote: review.adminInternalNote,
        creatorVisibleMessage: review.creatorVisibleMessage,
        rejectionReason: review.rejectionReason,
        changesRequestedReasons: review.changesRequestedReasons,
        stateSyncPending: true,
        stateSyncError: "",
        lastTransitionId: transitionId,
      },
      options: options(session),
    });
  } catch (error) {
    if (error.statusCode !== 409) throw error;
  }
  if (claimed) return claimed;

  const existing = await CreatorVerification.findById(id).session(session || null);
  if (!existing) throw new ApiError(404, "Creator verification not found");
  if (existing.status === targetStatus && existing.stateSyncPending) return existing;
  throw new ApiError(409, "Verification was already reviewed or changed by another admin");
}

async function synchronizeDecision(verification, config, previousStatus, session) {
  const transitionId = verification.lastTransitionId;
  await User.updateOne(
    { _id: verification.creator },
    { $set: { creatorApprovalStatus: config.approval, isVerified: config.verified } },
    options(session)
  );
  await CreatorProfile.updateOne(
    { user: verification.creator },
    { $set: { verificationStatus: config.profile }, $setOnInsert: { user: verification.creator } },
    { ...options(session), upsert: true, runValidators: true }
  );
  await VerificationReviewHistory.updateOne(
    { transitionId },
    {
      $setOnInsert: {
        verification: verification._id,
        creator: verification.creator,
        action: config.action,
        previousStatus,
        newStatus: verification.status,
        admin: verification.reviewedBy,
        internalNote: verification.adminInternalNote,
        creatorVisibleMessage: verification.creatorVisibleMessage,
        reason: verification.rejectionReason || verification.changesRequestedReasons.join(", "),
        transitionId,
      },
    },
    { ...options(session), upsert: true, runValidators: true }
  );
  await Notification.updateOne(
    { dedupeKey: transitionId },
    { $setOnInsert: { user: verification.creator, title: config.notification, type: config.notificationType, dedupeKey: transitionId } },
    { ...options(session), upsert: true, runValidators: true }
  );
  await CreatorVerification.updateOne(
    { _id: verification._id, lastTransitionId: transitionId },
    { $set: { stateSyncPending: false, stateSyncError: "" } },
    options(session)
  );
  verification.stateSyncPending = false;
  verification.stateSyncError = "";
  return verification;
}

async function runDecisionOperation(args, session) {
  const config = DECISIONS[args.targetStatus];
  const initial = await CreatorVerification.findById(args.id).session(session || null);
  if (!initial) throw new ApiError(404, "Creator verification not found");
  if (args.targetStatus === "APPROVED") assertCompleteApplication(initial);
  const transitionId = initial.status === args.targetStatus && initial.stateSyncPending
    ? initial.lastTransitionId
    : args.transitionId;
  const verification = await claimDecision({ ...args, transitionId, session });
  return synchronizeDecision(verification, config, "PENDING_REVIEW", session);
}

export async function performVerificationDecision(args) {
  if (!mongoose.isValidObjectId(args.id)) throw new ApiError(400, "Invalid verification ID");
  if (!DECISIONS[args.targetStatus]) throw new ApiError(400, "Unsupported verification decision");
  const operationArgs = { ...args, transitionId: crypto.randomUUID() };
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await runDecisionOperation(operationArgs, session); });
    return result;
  } catch (error) {
    if (!unsupportedTransaction(error)) throw error;
  } finally {
    await session.endSession();
  }

  try {
    return await runDecisionOperation(operationArgs, null);
  } catch (error) {
    await CreatorVerification.updateOne(
      { _id: args.id, stateSyncPending: true },
      { $set: { stateSyncError: String(error.message || "Decision synchronization failed").slice(0, 1000) } }
    ).catch(() => {});
    throw error;
  }
}

