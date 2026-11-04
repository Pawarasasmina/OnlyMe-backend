import mongoose from "mongoose";
const schema = new mongoose.Schema({
  targetType: { type: String, enum: ["USER", "CONTENT", "REPORT"], required: true, index: true },
  targetId: { type: String, required: true, maxlength: 120, index: true },
  reason: { type: String, required: true, trim: true, maxlength: 2000 },
  active: { type: Boolean, default: true, index: true },
  placedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  releasedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  releasedAt: { type: Date, default: null },
  releaseReason: { type: String, trim: true, maxlength: 2000, default: "" },
}, { timestamps: true });
schema.index({ targetType: 1, targetId: 1, active: 1 });
export default mongoose.model("LegalHold", schema);
