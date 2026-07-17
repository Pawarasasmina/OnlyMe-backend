import mongoose from "mongoose";
const schema = new mongoose.Schema({
  post: { type: mongoose.Schema.Types.ObjectId, ref: "WallPost", required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  type: { type: String, enum: ["REACTION", "COMMENT", "SHARE"], required: true, index: true },
  text: { type: String, trim: true, maxlength: 500, default: undefined },
}, { timestamps: true });
schema.index({ post: 1, user: 1, type: 1 }, { name: "unique_wall_reaction", unique: true, partialFilterExpression: { type: "REACTION" } });
schema.index({ post: 1, user: 1, type: 1, text: 1 }, { name: "unique_wall_share", unique: true, partialFilterExpression: { type: "SHARE" } });
schema.index({ post: 1, type: 1, createdAt: -1 });
export default mongoose.model("WallEngagement", schema);
