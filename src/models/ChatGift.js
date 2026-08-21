import mongoose from "mongoose";

const schema = new mongoose.Schema({
  message: { type: mongoose.Schema.Types.ObjectId, ref: "Message", required: true, unique: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  gift: { type: mongoose.Schema.Types.ObjectId, ref: "Gift", required: true },
  giftName: { type: String, required: true, maxlength: 80 },
  giftImageUrl: { type: String, required: true, maxlength: 2000 },
  starsAmount: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  debitLedgerEntry: { type: mongoose.Schema.Types.ObjectId, ref: "StarsLedgerEntry", required: true },
  creditLedgerEntry: { type: mongoose.Schema.Types.ObjectId, ref: "StarsLedgerEntry", required: true },
  idempotencyKey: { type: String, required: true, maxlength: 200 },
}, { timestamps: true });

schema.index({ sender: 1, idempotencyKey: 1 }, { unique: true });
export default mongoose.model("ChatGift", schema);
