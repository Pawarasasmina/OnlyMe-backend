import mongoose from "mongoose";
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  legalName: { type: String, required: true, maxlength: 160 },
  country: { type: String, required: true, maxlength: 80 },
  documentType: { type: String, enum: ["TRADE_LICENCE", "LOCAL_EQUIVALENT"], required: true },
  licenceNumber: { type: String, required: true, maxlength: 100 },
  issuingAuthority: { type: String, required: true, maxlength: 160 },
  expiresAt: { type: Date, required: true },
  document: { type: mongoose.Schema.Types.Mixed, required: true, select: false },
  status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED", "CHANGES_REQUESTED", "REVOKED"], default: "PENDING", index: true },
  feedback: { type: String, default: "", maxlength: 2000 },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  reviewedAt: { type: Date, default: null },
  history: [{ status: String, reason: String, actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, at: Date }],
}, { timestamps: true });
export default mongoose.model("BusinessVerification", schema);
