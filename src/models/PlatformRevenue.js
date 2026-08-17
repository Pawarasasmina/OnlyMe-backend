import mongoose from "mongoose";

const schema = new mongoose.Schema({
  sourceType: { type: String, enum: ["DIRECT_ACCESS", "PAID_CALL"], required: true },
  referenceId: { type: String, required: true, maxlength: 200 },
  fan: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  grossStars: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  creatorStars: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  platformStars: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  rateBasisPoints: { type: Number, required: true, default: 1000 },
  command: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialCommand", required: true },
  capturedAt: { type: Date, required: true, default: Date.now },
}, { timestamps: true, strict: "throw" });

schema.index({ sourceType: 1, referenceId: 1 }, { unique: true });
schema.index({ capturedAt: -1 });
schema.index({ creator: 1, capturedAt: -1 });

export default mongoose.model("PlatformRevenue", schema);
