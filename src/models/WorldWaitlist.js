import mongoose from "mongoose";

const schema = new mongoose.Schema({
  publication: { type: mongoose.Schema.Types.ObjectId, ref: "Publication", required: true, index: true },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  status: { type: String, enum: ["WAITING", "ADMITTED", "CANCELLED", "FAILED"], default: "WAITING", index: true },
  regularPriceStars: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  heldStars: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  introOfferApplied: { type: Boolean, default: false },
  holdLedgerEntry: { type: mongoose.Schema.Types.ObjectId, ref: "StarsLedgerEntry", default: null },
  membership: { type: mongoose.Schema.Types.ObjectId, ref: "PremiumMembership", default: null },
  admittedAt: { type: Date, default: null },
  cancelledAt: { type: Date, default: null },
}, { timestamps: true });

schema.index({ publication: 1, status: 1, createdAt: 1 });
schema.index({ publication: 1, user: 1 }, { unique: true, partialFilterExpression: { status: "WAITING" } });

export default mongoose.model("WorldWaitlist", schema);
