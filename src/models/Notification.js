import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, default: "system" },
    title: { type: String, required: true },
    message: { type: String, trim: true, maxlength: 2000, default: "" },
    severity: { type: String, enum: ["info", "warning", "critical"], default: "info" },
    priority: { type: Number, min: 0, max: 100, default: 0 },
    acknowledgedAt: { type: Date, default: null },
    relatedReport: { type: mongoose.Schema.Types.ObjectId, ref: "MessageReport", default: null },
    readAt: { type: Date, default: null },
    dedupeKey: { type: String, default: undefined, unique: true, sparse: true },
  },
  { timestamps: true }
);

export default mongoose.model("Notification", notificationSchema);

