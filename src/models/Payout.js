import mongoose from "mongoose";

const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  ledgerEntry: { type: mongoose.Schema.Types.ObjectId, ref: "StarsLedgerEntry", required: true, unique: true },
  command: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialCommand", required: true, unique: true },
  method: { type: String, enum: ["STANDARD"], default: "STANDARD" },
  trigger: { type: String, enum: ["MANUAL", "AUTOMATIC"], default: "MANUAL" },
  status: { type: String, enum: ["PENDING", "PROCESSING", "PAID", "FAILED", "CANCELED"], default: "PENDING", index: true },
  starsAmount: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  usdAmount: { type: Number, required: true, min: 0.01 },
  feeUsd: { type: Number, default: 0, min: 0 },
  bankLast4: { type: String, default: "", maxlength: 4 },
  failureReason: { type: String, default: "", maxlength: 500 },
  processedAt: { type: Date, default: null },
  paidAt: { type: Date, default: null },
  monthKey: { type: String, default: "", index: true },
}, { timestamps: true });

schema.index({ user: 1, createdAt: -1 });
schema.index({ status: 1, createdAt: 1 });
schema.index({ user: 1, trigger: 1, monthKey: 1 }, { unique: true, partialFilterExpression: { trigger: "AUTOMATIC", monthKey: { $type: "string" } } });
export default mongoose.model("Payout", schema);
