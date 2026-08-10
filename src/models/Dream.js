import mongoose from "mongoose";

const schema = new mongoose.Schema({
  creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  emoji: { type: String, trim: true, maxlength: 16, default: "✨" },
  title: { type: String, trim: true, required: true, maxlength: 40 },
  reason: { type: String, trim: true, required: true, maxlength: 120 },
  goalStars: { type: Number, required: true, enum: [500, 900, 1500, 2500, 5000] },
  receivedStars: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  supporterCount: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  status: { type: String, enum: ["ACTIVE", "COMPLETED", "REMOVED"], default: "ACTIVE", index: true },
  completedAt: { type: Date, default: null },
  removedAt: { type: Date, default: null },
  version: { type: Number, default: 1, min: 1 },
}, { timestamps: true });

schema.index({ creator: 1, status: 1 }, { unique: true, partialFilterExpression: { status: "ACTIVE" } });
export default mongoose.model("Dream", schema);
