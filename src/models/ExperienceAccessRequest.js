import mongoose from "mongoose";

const schema = new mongoose.Schema({
  publication: { type: mongoose.Schema.Types.ObjectId, ref: "Publication", required: true, index: true },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  requester: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED"], default: "PENDING", index: true },
  decidedAt: { type: Date, default: null },
}, { timestamps: true });

schema.index({ publication: 1, requester: 1 }, { unique: true });

export default mongoose.model("ExperienceAccessRequest", schema);
