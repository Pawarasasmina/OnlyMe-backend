import mongoose from "mongoose";

const seenEngagementSchema = new mongoose.Schema({
  publication: { type: mongoose.Schema.Types.ObjectId, ref: "Publication", required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  type: { type: String, enum: ["REACTION", "COMMENT", "SHARE"], required: true, index: true },
  reaction: { type: String, enum: ["LIKE", "LOVE", "INSIGHTFUL"], default: undefined },
  text: { type: String, trim: true, maxlength: 500, default: undefined },
}, { timestamps: true });

seenEngagementSchema.index({ publication: 1, user: 1, type: 1 }, { name: "unique_seen_reaction_per_user", unique: true, partialFilterExpression: { type: "REACTION" } });
seenEngagementSchema.index({ publication: 1, user: 1, type: 1, reaction: 1 }, { name: "unique_seen_share_per_user", unique: true, partialFilterExpression: { type: "SHARE" } });
seenEngagementSchema.index({ publication: 1, type: 1, createdAt: -1 });

export default mongoose.model("SeenEngagement", seenEngagementSchema);
