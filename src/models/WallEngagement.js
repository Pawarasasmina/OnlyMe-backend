import mongoose from "mongoose";
import { ACCOUNT_TYPES, DEFAULT_ACCOUNT_TYPE } from "../constants/accountTypeConstants.js";
export const WALL_REACTIONS = ["like", "love", "care", "haha", "wow", "sad", "angry"];
const schema = new mongoose.Schema({
  post: { type: mongoose.Schema.Types.ObjectId, ref: "WallPost", required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  actorAccountType: { type: String, enum: ACCOUNT_TYPES, default: DEFAULT_ACCOUNT_TYPE, index: true },
  type: { type: String, enum: ["REACTION", "COMMENT", "SHARE", "SAVE"], required: true, index: true },
  reaction: { type: String, enum: WALL_REACTIONS, default: undefined },
  text: { type: String, trim: true, maxlength: 500, default: undefined },
}, { timestamps: true });
schema.index({ post: 1, user: 1, type: 1 }, { name: "unique_wall_reaction", unique: true, partialFilterExpression: { type: "REACTION" } });
schema.index({ post: 1, user: 1, type: 1, text: 1 }, { name: "unique_wall_share", unique: true, partialFilterExpression: { type: "SHARE" } });
schema.index({ post: 1, user: 1, type: 1 }, { name: "unique_wall_save", unique: true, partialFilterExpression: { type: "SAVE" } });
schema.index({ post: 1, type: 1, createdAt: -1 });
export default mongoose.model("WallEngagement", schema);
