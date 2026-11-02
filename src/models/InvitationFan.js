import mongoose from "mongoose";

const schema = new mongoose.Schema({
  inviter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  fan: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  number: { type: Number, required: true },
  type: { type: String, enum: ["friend", "creator"], default: "friend" },
}, { timestamps: true });
schema.index({ inviter: 1, fan: 1 }, { unique: true });
schema.index({ inviter: 1, number: 1 }, { unique: true });
export default mongoose.model("InvitationFan", schema);
