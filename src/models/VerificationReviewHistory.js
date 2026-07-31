import mongoose from "mongoose";

export const VERIFICATION_ACTIONS = [
  "DRAFT_SAVED",
  "SUBMITTED",
  "RESUBMITTED",
  "CHANGES_REQUESTED",
  "APPROVED",
  "REJECTED",
  "LEGACY_MIGRATED",
];

const verificationReviewHistorySchema = new mongoose.Schema(
  {
    verification: { type: mongoose.Schema.Types.ObjectId, ref: "CreatorVerification", required: true, index: true },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    action: { type: String, enum: VERIFICATION_ACTIONS, required: true },
    previousStatus: { type: String, required: true },
    newStatus: { type: String, required: true },
    admin: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    internalNote: { type: String, trim: true, default: "", maxlength: 2000 },
    creatorVisibleMessage: { type: String, trim: true, default: "", maxlength: 2000 },
    reason: { type: String, trim: true, default: "", maxlength: 1000 },
    transitionId: { type: String, default: undefined, unique: true, sparse: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

verificationReviewHistorySchema.index({ verification: 1, createdAt: -1 });

export default mongoose.model("VerificationReviewHistory", verificationReviewHistorySchema);

