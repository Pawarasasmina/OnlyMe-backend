import mongoose from "mongoose";

const orbitSignalSchema = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    targetUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: ["SEE_YOU"], default: "SEE_YOU" },
    status: { type: String, enum: ["active", "revoked", "expired"], default: "active", index: true },
  },
  { timestamps: true }
);

orbitSignalSchema.index(
  { sender: 1, targetUser: 1, type: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "active" } }
);
orbitSignalSchema.index({ createdAt: -1 });

export default mongoose.model("OrbitSignal", orbitSignalSchema);
