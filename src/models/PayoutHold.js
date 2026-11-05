import mongoose from "mongoose";
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  active: { type: Boolean, default: true, index: true },
  reason: { type: String, required: true, trim: true, maxlength: 2000 },
  placedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  releasedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  releasedAt: { type: Date, default: null },
  releaseReason: { type: String, trim: true, maxlength: 2000, default: "" },
}, { timestamps: true });
schema.index({ user: 1, active: 1 }, { unique: true, partialFilterExpression: { active: true } });
export default mongoose.model("PayoutHold", schema);
