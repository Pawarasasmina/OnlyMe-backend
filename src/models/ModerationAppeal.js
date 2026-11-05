import mongoose from "mongoose";

const schema = new mongoose.Schema({
  appellant: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  reportModel: { type: String, enum: ["MessageReport", "PublicationReport"], required: true },
  reportId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  actionedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  action: { type: String, required: true, maxlength: 80 },
  statement: { type: String, required: true, trim: true, maxlength: 3000 },
  status: { type: String, enum: ["PENDING", "REVIEWING", "UPHELD", "REVERSED", "PARTIALLY_REVERSED"], default: "PENDING", index: true },
  reviewer: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  reviewReason: { type: String, trim: true, maxlength: 3000, default: "" },
  reviewedAt: { type: Date, default: null },
}, { timestamps: true });
schema.index({ reportModel: 1, reportId: 1, appellant: 1 }, { unique: true });
schema.index({ status: 1, createdAt: 1 });
export default mongoose.model("ModerationAppeal", schema);
