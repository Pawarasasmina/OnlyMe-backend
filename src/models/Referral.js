import mongoose from "mongoose";

const referralSchema = new mongoose.Schema({
  inviter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  invitee: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
  code: { type: String, required: true, trim: true, lowercase: true, index: true },
  type: { type: String, enum: ["creator", "friend"], required: true },
  attributedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true, index: true },
  earningsAmount: { type: Number, min: 0, default: 0 },
  coins: { type: Number, min: 0, default: 0 },
  latestEarningAmount: { type: Number, min: 0, default: 0 },
  latestEarningCoins: { type: Number, min: 0, default: 0 },
}, { timestamps: true });

referralSchema.index({ inviter: 1, createdAt: -1 });

export default mongoose.model("Referral", referralSchema);
