import mongoose from "mongoose";

export const VERIFIED_CREATOR_STATUSES = ["NOT_APPLIED", "PENDING", "APPROVED", "REJECTED", "EXPIRED", "CANCELLED"];

const verifiedCreatorSubscriptionSchema = new mongoose.Schema(
  {
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
    status: { type: String, enum: VERIFIED_CREATOR_STATUSES, default: "NOT_APPLIED", index: true },
    starsPerMonth: { type: Number, required: true, default: 190, min: 1, max: 1000000, validate: Number.isSafeInteger },
    autoRenew: { type: Boolean, default: true },
    statement: { type: String, trim: true, maxlength: 1000, default: "" },
    submittedAt: { type: Date, default: null },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    adminNote: { type: String, trim: true, maxlength: 2000, default: "" },
    creatorMessage: { type: String, trim: true, maxlength: 2000, default: "" },
    currentPeriodStart: { type: Date, default: null },
    currentPeriodEnd: { type: Date, default: null, index: true },
    lastPaidAt: { type: Date, default: null },
    paymentStatus: { type: String, enum: ["NOT_STARTED", "PAID", "PAST_DUE"], default: "NOT_STARTED" },
    expiryNoticeSentAt: { type: Date, default: null },
    latestLedgerEntry: { type: mongoose.Schema.Types.ObjectId, ref: "StarsLedgerEntry", default: null },
  },
  { timestamps: true }
);

export default mongoose.model("VerifiedCreatorSubscription", verifiedCreatorSubscriptionSchema);
