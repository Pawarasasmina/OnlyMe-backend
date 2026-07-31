import mongoose from "mongoose";

const orbitDreamSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    emoji: { type: String, trim: true, maxlength: 8, default: "\u2728" },
    status: { type: String, enum: ["active", "completed", "paused"], default: "active", index: true },
    visibility: { type: String, enum: ["public", "private"], default: "public", index: true },
    currentAmount: { type: Number, default: 0, min: 0 },
    goalAmount: { type: Number, default: 0, min: 0 },
    supporterCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

orbitDreamSchema.index({ user: 1, status: 1, visibility: 1 });

export default mongoose.model("OrbitDream", orbitDreamSchema);
