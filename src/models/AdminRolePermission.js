import mongoose from "mongoose";
import { ADMIN_PERMISSION_KEYS } from "../constants/adminPermissionConstants.js";

const schema = new mongoose.Schema({
  adminRole: { type: String, enum: ["MODERATOR", "FINANCE"], required: true, unique: true, index: true },
  permissions: [{ type: String, enum: ADMIN_PERMISSION_KEYS }],
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

export default mongoose.model("AdminRolePermission", schema);
