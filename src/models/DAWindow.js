import mongoose from "mongoose";

export const DA_WINDOW_STATUSES = ["OPEN", "ANSWERED", "EXPIRED", "CLOSED"];
export const DA_SETTLEMENT_STATUSES = ["HELD", "CAPTURED", "REFUND_PENDING", "REFUNDED", "INCLUDED"];
export const DA_WINDOW_SOURCES = ["PAID", "PREMIUM_INCLUDED", "CREATOR_REOPEN", "FAN_FOLLOWUP"];

const daWindowSchema = new mongoose.Schema(
  {
    fan: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    activeWindowKey: { type: String, unique: true, sparse: true, default: undefined },
    status: { type: String, enum: DA_WINDOW_STATUSES, default: "OPEN", required: true },
    settlementStatus: { type: String, enum: DA_SETTLEMENT_STATUSES, required: true },
    source: { type: String, enum: DA_WINDOW_SOURCES, default: "PAID", required: true },
    priceStars: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
    fanMessageLimit: { type: Number, default: 3, min: 1, max: 3, validate: Number.isSafeInteger },
    fanMessagesUsed: { type: Number, default: 0, min: 0, max: 3, validate: Number.isSafeInteger },
    openedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    firstCreatorReplyAt: { type: Date, default: null },
    answeredAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    expiredAt: { type: Date, default: null },
    capturedAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
    openingCommand: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialCommand", default: null },
    captureCommand: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialCommand", default: null },
    refundCommand: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialCommand", default: null },
    holdLedgerEntry: { type: mongoose.Schema.Types.ObjectId, ref: "StarsLedgerEntry", default: null },
    creatorEarningLedgerEntry: { type: mongoose.Schema.Types.ObjectId, ref: "StarsLedgerEntry", default: null },
    platformRevenue: { type: mongoose.Schema.Types.ObjectId, ref: "PlatformRevenue", default: null },
    refundLedgerEntry: { type: mongoose.Schema.Types.ObjectId, ref: "StarsLedgerEntry", default: null },
    reopenedFromWindow: { type: mongoose.Schema.Types.ObjectId, ref: "DAWindow", default: null },
    threadRootWindow: { type: mongoose.Schema.Types.ObjectId, ref: "DAWindow", default: null, index: true },
    creatorQuestionMessage: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
    version: { type: Number, default: 1, min: 1 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, strict: "throw" },
);

daWindowSchema.index({ status: 1, expiresAt: 1 });
daWindowSchema.index({ fan: 1, createdAt: -1 });
daWindowSchema.index({ creator: 1, status: 1, createdAt: -1 });
daWindowSchema.index({ settlementStatus: 1, updatedAt: 1 });

export default mongoose.model("DAWindow", daWindowSchema);
