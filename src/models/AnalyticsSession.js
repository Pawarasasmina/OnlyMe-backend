import mongoose from "mongoose";

const analyticsSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sessionId: { type: String, required: true, trim: true, maxlength: 80, unique: true },
    startedAt: { type: Date, required: true, default: Date.now, index: true },
    lastActivityAt: { type: Date, required: true, default: Date.now, index: true },
    endedAt: { type: Date, default: null },
    durationSeconds: { type: Number, min: 0, default: 0 },
    deviceType: { type: String, enum: ["desktop", "mobile", "tablet", "unknown"], default: "unknown" },
  },
  { timestamps: true }
);

analyticsSessionSchema.index({ userId: 1, startedAt: -1 });
analyticsSessionSchema.index({ startedAt: 1, userId: 1 });
analyticsSessionSchema.index({ lastActivityAt: -1 });

export default mongoose.model("AnalyticsSession", analyticsSessionSchema);
