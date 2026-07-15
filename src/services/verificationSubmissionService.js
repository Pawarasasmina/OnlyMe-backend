import crypto from "node:crypto";
import mongoose from "mongoose";
import CreatorProfile from "../models/CreatorProfile.js";
import CreatorVerification from "../models/CreatorVerification.js";
import User from "../models/User.js";
import VerificationReviewHistory from "../models/VerificationReviewHistory.js";
import ApiError from "../utils/ApiError.js";
import { assertCompleteApplication } from "../validators/verificationValidator.js";

const unsupportedTransaction = (error) => /Transaction numbers are only allowed|does not support transactions|replica set/i.test(error.message || "");
const options = (session) => session ? { session } : {};

async function runSubmission({ creatorId, allowedStatuses, action, transitionId }, session) {
  const initial = await CreatorVerification.findOne({ creator: creatorId }).session(session || null);
  if (!initial) throw new ApiError(404, "Creator verification not found");
  const retrying = initial.status === "PENDING_REVIEW" && initial.stateSyncPending && initial.lastTransitionId;
  if (!retrying && !allowedStatuses.includes(initial.status)) {
    throw new ApiError(409, action === "RESUBMITTED" ? "Only a changes-requested application can be resubmitted" : "Verification cannot be submitted in its current status");
  }
  assertCompleteApplication(initial);
  const previousStatus = retrying ? (action === "RESUBMITTED" ? "CHANGES_REQUESTED" : "DRAFT") : initial.status;
  const activeTransitionId = retrying ? initial.lastTransitionId : transitionId;
  let verification = initial;
  if (!retrying) {
    verification = await CreatorVerification.findOneAndUpdate(
      { _id: initial._id, creator: creatorId, status: { $in: allowedStatuses } },
      {
        $set: {
          status: "PENDING_REVIEW",
          submittedAt: new Date(),
          reviewedAt: null,
          reviewedBy: null,
          adminInternalNote: "",
          creatorVisibleMessage: "",
          rejectionReason: "",
          changesRequestedReasons: [],
          stateSyncPending: true,
          stateSyncError: "",
          lastTransitionId: activeTransitionId,
        },
      },
      { new: true, runValidators: true, ...options(session) }
    );
    if (!verification) throw new ApiError(409, "Verification changed while it was being submitted");
  }

  await User.updateOne({ _id: creatorId }, { $set: { creatorApprovalStatus: "pending", isVerified: false } }, options(session));
  await CreatorProfile.updateOne(
    { user: creatorId },
    { $set: { verificationStatus: "pending" }, $setOnInsert: { user: creatorId } },
    { ...options(session), upsert: true, runValidators: true }
  );
  await VerificationReviewHistory.updateOne(
    { transitionId: activeTransitionId },
    { $setOnInsert: { verification: verification._id, creator: creatorId, action, previousStatus, newStatus: "PENDING_REVIEW", transitionId: activeTransitionId } },
    { ...options(session), upsert: true, runValidators: true }
  );
  await CreatorVerification.updateOne(
    { _id: verification._id, lastTransitionId: activeTransitionId },
    { $set: { stateSyncPending: false, stateSyncError: "" } },
    options(session)
  );
  verification.stateSyncPending = false;
  return verification;
}

export async function performVerificationSubmission(args) {
  const operationArgs = { ...args, transitionId: crypto.randomUUID() };
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await runSubmission(operationArgs, session); });
    return result;
  } catch (error) {
    if (!unsupportedTransaction(error)) throw error;
  } finally {
    await session.endSession();
  }
  try {
    return await runSubmission(operationArgs, null);
  } catch (error) {
    await CreatorVerification.updateOne(
      { creator: args.creatorId, stateSyncPending: true },
      { $set: { stateSyncError: String(error.message || "Submission synchronization failed").slice(0, 1000) } }
    ).catch(() => {});
    throw error;
  }
}
