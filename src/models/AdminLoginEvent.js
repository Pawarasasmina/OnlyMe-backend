import mongoose from "mongoose";
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  outcome: { type: String, enum: ["SUCCESS", "FAILED", "LOGOUT", "FORCE_LOGOUT"], required: true },
  ip: { type: String, maxlength: 100, default: "" },
  userAgent: { type: String, maxlength: 500, default: "" },
  deviceType: { type: String, enum: ["desktop", "mobile", "tablet", "unknown"], default: "unknown" },
}, { timestamps: { createdAt: true, updatedAt: false } });
schema.index({ user: 1, createdAt: -1 });
export default mongoose.model("AdminLoginEvent", schema);
