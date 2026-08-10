import mongoose from "mongoose";

const schema = new mongoose.Schema({
  dream: { type: mongoose.Schema.Types.ObjectId, ref: "Dream", required: true, index: true },
  supporter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  giftKey: { type: String, required: true, maxlength: 40 },
  giftName: { type: String, required: true, maxlength: 80 },
  starsAmount: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  privateSupport: { type: Boolean, default: false },
  debitLedgerEntry: { type: mongoose.Schema.Types.ObjectId, ref: "StarsLedgerEntry", required: true },
  creditLedgerEntry: { type: mongoose.Schema.Types.ObjectId, ref: "StarsLedgerEntry", required: true },
  idempotencyKey: { type: String, required: true, maxlength: 200 },
}, { timestamps: true });

schema.index({ supporter: 1, idempotencyKey: 1 }, { unique: true });
schema.index({ dream: 1, createdAt: -1 });
export default mongoose.model("DreamGift", schema);
