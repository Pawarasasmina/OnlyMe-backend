import mongoose from "mongoose";
const schema = new mongoose.Schema({
  membership: { type: mongoose.Schema.Types.ObjectId, ref: "PremiumMembership", required: true, index: true },
  premiumPublication: { type: mongoose.Schema.Types.ObjectId, ref: "Publication", required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true }, creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  type: { type: String, enum: ["INITIAL", "RENEWAL"], required: true }, status: { type: String, enum: ["SUCCEEDED", "FAILED", "REFUNDED"], required: true, index: true },
  amountStars: { type: Number, required: true, min: 1, validate: Number.isSafeInteger }, periodStart: { type: Date, required: true }, periodEnd: { type: Date, required: true },
  attemptedAt: { type: Date, required: true, default: Date.now }, succeededAt: { type: Date, default: null }, failedAt: { type: Date, default: null },
  failureCode: { type: String, default: null, maxlength: 120 }, failureMessage: { type: String, default: null, maxlength: 500 },
  debitLedgerEntry: { type: mongoose.Schema.Types.ObjectId, ref: "StarsLedgerEntry", default: null }, creditLedgerEntry: { type: mongoose.Schema.Types.ObjectId, ref: "StarsLedgerEntry", default: null },
  refundedAt: { type: Date, default: null }, refundReason: { type: String, default: null, maxlength: 2000 }, refundedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }, refundCommand: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialCommand", default: null },
  idempotencyKey: { type: String, required: true, maxlength: 200 },
}, { timestamps: true, strict: "throw" });
schema.index({ premiumPublication: 1, attemptedAt: -1 });
schema.index({ membership: 1, periodStart: 1, type: 1 }, { unique: true });
schema.index({ idempotencyKey: 1 }, { unique: true });
export default mongoose.model("MembershipPayment", schema);
