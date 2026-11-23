import mongoose from "mongoose";

const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  message: { type: String, required: true, trim: true, maxlength: 2000 },
  actionLabel: { type: String, trim: true, maxlength: 80, default: "" },
  actionUrl: { type: String, trim: true, maxlength: 500, default: "" },
  channels: [{ type: String, enum: ["IN_APP", "EMAIL"], required: true }],
  audience: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  status: { type: String, enum: ["SCHEDULED", "PROCESSING", "COMPLETED", "CANCELLED"], default: "SCHEDULED", index: true },
  scheduledAt: { type: Date, required: true, index: true },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  cancelledAt: { type: Date, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  counts: {
    recipients: { type: Number, default: 0 }, pending: { type: Number, default: 0 },
    processed: { type: Number, default: 0 }, inAppDelivered: { type: Number, default: 0 },
    emailDelivered: { type: Number, default: 0 }, emailSkipped: { type: Number, default: 0 }, emailFailed: { type: Number, default: 0 },
  },
}, { timestamps: true });

schema.index({ status: 1, scheduledAt: 1 });
export default mongoose.model("CreatorAnnouncement", schema);
