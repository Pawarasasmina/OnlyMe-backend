import mongoose from "mongoose";

const recommendationConfigSchema = new mongoose.Schema({
  version: { type: Number, required: true, unique: true, min: 1 },
  status: { type: String, enum: ["DRAFT", "ACTIVE", "ARCHIVED"], required: true, index: true },
  config: { type: mongoose.Schema.Types.Mixed, required: true },
  note: { type: String, trim: true, maxlength: 300, default: "" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  activatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  activatedAt: { type: Date, default: null },
}, { timestamps: true });

recommendationConfigSchema.index({ status: 1, activatedAt: -1 });

export default mongoose.model("RecommendationConfig", recommendationConfigSchema);
