import mongoose from "mongoose";

const schema = new mongoose.Schema({
  reportModel: { type: String, enum: ["MessageReport", "PublicationReport"], required: true, index: true },
  reportId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  stage: { type: String, enum: ["NEW", "UNCLAIMED_30M", "DUE_SOON", "OVERDUE", "OVERDUE_REPEAT"], required: true },
  channel: { type: String, enum: ["IN_APP", "EMAIL", "TELEGRAM"], required: true },
  recipientKey: { type: String, required: true },
  status: { type: String, enum: ["PENDING", "SENDING", "DELIVERED", "SKIPPED", "FAILED"], default: "PENDING", index: true },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  deliveredAt: { type: Date, default: null },
  providerId: { type: String, default: "" },
  error: { type: String, default: "", maxlength: 1000 },
}, { timestamps: true });

schema.index({ reportModel: 1, reportId: 1, stage: 1, channel: 1, recipientKey: 1 }, { unique: true });
schema.index({ status: 1, nextAttemptAt: 1 });

export default mongoose.model("ModerationAlert", schema);
