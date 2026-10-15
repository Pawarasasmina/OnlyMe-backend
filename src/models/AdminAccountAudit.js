import mongoose from "mongoose";
import { ACCOUNT_TYPES } from "../constants/accountTypeConstants.js";

const schema = new mongoose.Schema({
  admin: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  action: { type: String, enum: ["ACCOUNT_TYPE_CHANGED", "ACCOUNT_STATUS_CHANGED"], required: true },
  previousAccountType: { type: String, enum: ACCOUNT_TYPES, default: undefined },
  accountType: { type: String, enum: ACCOUNT_TYPES, default: undefined },
  previousStatus: { type: String, enum: ["active", "suspended"], default: undefined },
  status: { type: String, enum: ["active", "suspended"], default: undefined },
  reason: { type: String, trim: true, maxlength: 500, required: true },
}, { timestamps: true, strict: "throw" });

schema.index({ user: 1, createdAt: -1 });
schema.index({ admin: 1, createdAt: -1 });

export default mongoose.model("AdminAccountAudit", schema);
