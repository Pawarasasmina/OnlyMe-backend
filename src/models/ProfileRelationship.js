import mongoose from "mongoose";
import { ACCOUNT_TYPES, DEFAULT_ACCOUNT_TYPE } from "../constants/accountTypeConstants.js";

const profileRelationshipSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    actorAccountType: { type: String, enum: ACCOUNT_TYPES, default: DEFAULT_ACCOUNT_TYPE, index: true },
    target: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: ["FOLLOW", "SEE_SIGNAL"], required: true },
    seenTodayViewedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

profileRelationshipSchema.index({ actor: 1, target: 1, type: 1 }, { unique: true });
profileRelationshipSchema.index({ target: 1, type: 1, createdAt: -1 });

export default mongoose.model("ProfileRelationship", profileRelationshipSchema);
