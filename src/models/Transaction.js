import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema(
  {
    wallet: { type: mongoose.Schema.Types.ObjectId, ref: "Wallet", required: true },
    amount: { type: Number, required: true },
    type: { type: String, default: "credit" },
    status: { type: String, default: "pending" },
    description: { type: String, default: "" },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    content: { type: mongoose.Schema.Types.ObjectId, ref: "Content", default: null },
  },
  { timestamps: true }
);

export default mongoose.model("Transaction", transactionSchema);
