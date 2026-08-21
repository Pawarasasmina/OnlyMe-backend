import mongoose from "mongoose";

const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
  enabledGifts: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Gift" }], default: [] },
}, { timestamps: true });

export default mongoose.model("GiftPreference", schema);
