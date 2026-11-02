import mongoose from "mongoose";
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", unique: true, required: true },
  sessionId: String,
  status: { type: String, default: "not_started" },
  errorCode: String,
  verifiedAt: Date,
  connectAccountId: String,
  bankLast4: String,
  payoutsEnabled: { type: Boolean, default: false },
  automaticPayout: { type: Boolean, default: true },
  sealRevokedAt: Date,
  sealRevokedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  sealRevocationReason: String,
  history: [{ action: String, by: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, reason: String, at: { type: Date, default: Date.now } }],
}, { timestamps: true });
export default mongoose.model("IdentityVerification", schema);
