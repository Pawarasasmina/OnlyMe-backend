import mongoose from "mongoose";
import { ACCOUNT_TYPES, DEFAULT_ACCOUNT_TYPE } from "../constants/accountTypeConstants.js";
const schema = new mongoose.Schema({ story: { type: mongoose.Schema.Types.ObjectId, ref: "Story", required: true, index: true }, fan: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true }, actorAccountType: { type: String, enum: ACCOUNT_TYPES, default: DEFAULT_ACCOUNT_TYPE, index: true }, viewedAt: { type: Date, default: null }, reaction: { type: String, maxlength: 12, default: "" } }, { timestamps: true });
schema.index({ story: 1, fan: 1 }, { unique: true });
export default mongoose.model("StoryEngagement", schema);
