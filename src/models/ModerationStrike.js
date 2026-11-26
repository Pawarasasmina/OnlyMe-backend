import mongoose from "mongoose";

const moderationStrikeSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  reportModel: { type: String, enum: ["MessageReport", "PublicationReport"], required: true },
  reportId: { type: mongoose.Schema.Types.ObjectId, required: true },
  category: { type: String, required: true, trim: true },
  scope: { type: String, required: true, trim: true },
  resolutionAction: { type: String, required: true, trim: true },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  resolvedAt: { type: Date, required: true },
  active: { type: Boolean, default: true, index: true },
  strikeNumberAtIssue: { type: Number, min: 1, required: true },
  automaticConsequence: { type: String, enum: ["WARNING", "POSTING_RESTRICTED_7_DAYS", "BANNED"], required: true },
  reversedAt: { type: Date, default: null },
  reversedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  reversalReason: { type: String, trim: true, maxlength: 2000, default: "" },
}, { timestamps: true });

moderationStrikeSchema.index({ reportModel: 1, reportId: 1 }, { unique: true });
moderationStrikeSchema.index({ user: 1, active: 1, resolvedAt: -1 });

export default mongoose.model("ModerationStrike", moderationStrikeSchema);
