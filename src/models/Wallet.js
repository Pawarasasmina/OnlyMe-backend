import mongoose from "mongoose";

const walletSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    balance: { type: Number, default: 0 },
    currency: { type: String, default: "USD" },
  },
  { timestamps: true }
);

export default mongoose.model("Wallet", walletSchema);
