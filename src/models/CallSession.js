import mongoose from "mongoose";

export const CALL_STATUSES = ["REQUESTED", "RINGING", "ACTIVE", "COMPLETED", "DECLINED", "MISSED", "CANCELED", "FAILED"];

const callSessionSchema = new mongoose.Schema({
  caller: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  type: { type: String, enum: ["AUDIO", "VIDEO"], required: true },
  status: { type: String, enum: CALL_STATUSES, default: "RINGING", required: true },
  answeredAt: { type: Date, default: null },
  endedAt: { type: Date, default: null },
  durationSeconds: { type: Number, default: 0, min: 0 },
  endedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  endReason: { type: String, maxlength: 80, default: "" },
  paid: { type: Boolean, default: false },
  priceStars: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  durationLimitSeconds: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  settlementStatus: { type: String, enum: ["FREE", "HELD", "CAPTURED", "REFUND_PENDING", "REFUNDED"], default: "FREE" },
  requestExpiresAt: { type: Date, default: null },
  connectedAt: { type: Date, default: null },
  connectedBy: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
  holdLedgerEntry: { type: mongoose.Schema.Types.ObjectId, ref: "StarsLedgerEntry", default: null },
  openingCommand: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialCommand", default: null },
  captureCommand: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialCommand", default: null },
  refundCommand: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialCommand", default: null },
  creatorEarningLedgerEntry: { type: mongoose.Schema.Types.ObjectId, ref: "StarsLedgerEntry", default: null },
  refundLedgerEntry: { type: mongoose.Schema.Types.ObjectId, ref: "StarsLedgerEntry", default: null },
  platformRevenue: { type: mongoose.Schema.Types.ObjectId, ref: "PlatformRevenue", default: null },
}, { timestamps: true });

callSessionSchema.index({ caller: 1, createdAt: -1 });
callSessionSchema.index({ recipient: 1, createdAt: -1 });
callSessionSchema.index({ status: 1, updatedAt: 1 });
callSessionSchema.index({ settlementStatus: 1, requestExpiresAt: 1 });

export default mongoose.model("CallSession", callSessionSchema);
