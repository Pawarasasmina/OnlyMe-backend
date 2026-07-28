import mongoose from "mongoose";

const messageReportSchema = new mongoose.Schema({
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  reportedUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  scope: { type: String, enum: ["MESSAGE", "CONVERSATION"], required: true },
  message: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
  reason: {
    type: String,
    enum: ["SPAM", "HARASSMENT", "HATE", "SEXUAL_CONTENT", "VIOLENCE", "SCAM", "OTHER"],
    required: true,
  },
  details: { type: String, trim: true, maxlength: 1000, default: "" },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true, select: false },
  status: { type: String, enum: ["RECEIVED", "REVIEWING", "CLOSED"], default: "RECEIVED", index: true },
}, { timestamps: true });

messageReportSchema.index(
  { reporter: 1, message: 1 },
  { unique: true, partialFilterExpression: { scope: "MESSAGE" } },
);
messageReportSchema.index({ status: 1, createdAt: 1 });

export default mongoose.model("MessageReport", messageReportSchema);
