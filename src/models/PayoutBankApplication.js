import mongoose from "mongoose";
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  status: { type: String, enum: ["PENDING_REVIEW", "APPROVED", "REJECTED", "CHANGES_REQUESTED"], required: true, index: true },
  accountHolder: { type: String, required: true, maxlength: 150 },
  bankName: { type: String, required: true, maxlength: 150 },
  country: { type: String, required: true },
  currency: { type: String, required: true },
  accountLast4: { type: String, required: true },
  encryptedDetails: { type: String, required: true, select: false },
  version: { type: Number, default: 1 },
  automaticPayout: { type: Boolean, default: true },
  submittedAt: { type: Date, required: true },
  reviewedAt: { type: Date, default: null },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  reviewMessage: { type: String, default: "", maxlength: 1000 },
  history: [{ action: String, by: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, at: Date, note: String, version: Number }],
}, { timestamps: true });
export default mongoose.model("PayoutBankApplication", schema);
