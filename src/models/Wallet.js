import mongoose from "mongoose";

const walletSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    balance: { type: Number, default: 0, min: 0, validate: { validator: Number.isSafeInteger, message: "Wallet balance must be integer Stars" } },
    bonusBalance: { type: Number, default: 0, min: 0, validate: { validator: Number.isSafeInteger, message: "Wallet bonus balance must be integer Stars" } },
    purchasedBalance: { type: Number, default: 0, min: 0, validate: { validator: Number.isSafeInteger, message: "Wallet purchased balance must be integer Stars" } },
    earnedBalance: { type: Number, default: 0, min: 0, validate: { validator: Number.isSafeInteger, message: "Wallet earned balance must be integer Stars" } },
    currency: { type: String, default: "STARS" },
    version: { type: Number, default: 0, min: 0 },
    lastLedgerEntry: { type: mongoose.Schema.Types.ObjectId, ref: "StarsLedgerEntry", default: null },
    ledgerActivatedAt: { type: Date, default: null },
    reconciliationStatus: { type: String, enum: ["NOT_ACTIVATED","MATCHED","DRIFT","BLOCKED"], default: "NOT_ACTIVATED" },
  },
  { timestamps: true }
);

export default mongoose.model("Wallet", walletSchema);
