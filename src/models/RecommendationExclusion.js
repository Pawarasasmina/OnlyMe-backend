import mongoose from "mongoose";

const schema = new mongoose.Schema({
  targetModel: { type: String, enum: ["User", "Publication", "FeedPost", "WallPost", "Story", "Content"], required: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
  label: { type: String, maxlength: 200, default: "" },
  reason: { type: String, maxlength: 500, required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });
schema.index({ targetModel: 1, targetId: 1 }, { unique: true });
export default mongoose.model("RecommendationExclusion", schema);
