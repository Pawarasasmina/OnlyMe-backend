import mongoose from "mongoose";

const repostSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  kind: { type: String, enum: ["seen", "note", "cm", "photo"], required: true, index: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  targetModel: { type: String, enum: ["Publication", "WallPost", "FeedPost", "SeenEngagement", "WallEngagement", "WallShareEngagement", "ProfileMedia"], required: true },
  originalAuthor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
}, { timestamps: true });

repostSchema.index({ user: 1, kind: 1, targetId: 1 }, { unique: true });
repostSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model("Repost", repostSchema);
