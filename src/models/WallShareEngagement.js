import mongoose from "mongoose";
import { WALL_REACTIONS } from "./WallEngagement.js";

const schema = new mongoose.Schema({
  share: { type: mongoose.Schema.Types.ObjectId, ref: "WallEngagement", required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  type: { type: String, enum: ["REACTION", "COMMENT", "SAVE"], required: true, index: true },
  reaction: { type: String, enum: WALL_REACTIONS, default: undefined },
  text: { type: String, trim: true, maxlength: 500, default: undefined },
}, { timestamps: true });

schema.index({ share: 1, user: 1, type: 1 }, { name: "unique_wall_share_reaction", unique: true, partialFilterExpression: { type: "REACTION" } });
schema.index({ share: 1, user: 1, type: 1 }, { name: "unique_wall_share_save", unique: true, partialFilterExpression: { type: "SAVE" } });
schema.index({ share: 1, type: 1, createdAt: -1 });

export default mongoose.model("WallShareEngagement", schema);
