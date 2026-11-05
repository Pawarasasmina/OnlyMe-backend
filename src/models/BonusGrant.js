import mongoose from "mongoose";
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  sourceLedgerEntry: { type: mongoose.Schema.Types.ObjectId, ref: "StarsLedgerEntry", required: true, unique: true },
  grantedStars: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  remainingStars: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  packBonusStars: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  welcomeBonusStars: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  expiresAt: { type: Date, required: true, index: true },
  expiredAt: { type: Date, default: null },
}, { timestamps: true });
schema.index({ user: 1, remainingStars: 1, expiresAt: 1 });
schema.index({ user: 1 }, { unique: true, partialFilterExpression: { welcomeBonusStars: { $gt: 0 } } });
export default mongoose.model("BonusGrant", schema);
