import mongoose from "mongoose";
// Durable history is independent from note deletion and the rolling quota cache.
const schema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  key: { type: String, required: true },
  postId: { type: mongoose.Schema.Types.ObjectId, ref: "FeedPost", default: null },
  postType: { type: String, default: "" },
  textHash: { type: String, default: "" },
  normalizedText: { type: String, default: "" },
  textHistory: { type: [String], default: [] },
  publishedAt: { type: Date, required: true },
}, { timestamps: true });
schema.index({ author: 1, key: 1 }, { unique: true });
schema.index({ publishedAt: -1 });
schema.index({ author: 1, publishedAt: -1 });
schema.index({ textHash: 1, publishedAt: -1 });
export default mongoose.model("WallPublicationLog", schema);
