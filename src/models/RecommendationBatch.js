import mongoose from "mongoose";

const recommendationBatchSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  surface: { type: String, enum: ["SEEN", "WALL", "DISCOVER", "STORIES"], required: true, index: true },
  sessionId: { type: String, trim: true, maxlength: 80, default: "", index: true },
  configVersion: { type: Number, required: true },
  itemIds: [{ type: String, trim: true, maxlength: 80 }],
  reasons: { type: mongoose.Schema.Types.Mixed, default: {} },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });

recommendationBatchSchema.index({ user: 1, surface: 1, createdAt: -1 });

export default mongoose.model("RecommendationBatch", recommendationBatchSchema);
