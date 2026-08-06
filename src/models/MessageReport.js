import mongoose from "mongoose";

const messageReportSchema = new mongoose.Schema({
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  reportedUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  scope: { type: String, enum: ["MESSAGE", "GROUP_MESSAGE", "CONVERSATION"], required: true },
  message: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
  groupMessage: { type: mongoose.Schema.Types.ObjectId, ref: "GroupMessage", default: null },
  reason: {
    type: String,
    enum: ["SPAM", "HARASSMENT", "HATE", "SEXUAL_CONTENT", "VIOLENCE", "SCAM", "OTHER"],
    required: true,
  },
  details: { type: String, trim: true, maxlength: 1000, default: "" },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true, select: false },
  status: { type: String, enum: ["RECEIVED", "REVIEWING", "RESOLVED", "CLOSED"], default: "RECEIVED", index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  reviewingAt: { type: Date, default: null },
  resolvedAt: { type: Date, default: null },
  resolution: {
    action: { type: String, enum: ["NO_ACTION", "WARNING", "MESSAGING_RESTRICTED", "RESTRICTION_LIFTED"], default: null },
    note: { type: String, trim: true, maxlength: 2000, default: "" },
    restrictionUntil: { type: Date, default: null },
    restrictionLiftedAt: { type: Date, default: null },
    restrictionLiftedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    restrictionLiftNote: { type: String, trim: true, maxlength: 2000, default: "" },
  },
}, { timestamps: true });

messageReportSchema.index(
  { reporter: 1, message: 1 },
  { unique: true, partialFilterExpression: { scope: "MESSAGE" } },
);
messageReportSchema.index({ status: 1, createdAt: 1 });
messageReportSchema.index({ reporter: 1, groupMessage: 1 }, { unique: true, partialFilterExpression: { scope: "GROUP_MESSAGE" } });

export default mongoose.model("MessageReport", messageReportSchema);
