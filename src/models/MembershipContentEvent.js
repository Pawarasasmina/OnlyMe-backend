import mongoose from "mongoose";

// Metadata only: survives story expiry without retaining private story media/text.
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  kind: { type: String, enum: ["STORY", "CHAPTER"], required: true },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  publication: { type: mongoose.Schema.Types.ObjectId, ref: "Publication", default: null },
  occurredAt: { type: Date, required: true },
}, { timestamps: true });
schema.index({ creator: 1, kind: 1, occurredAt: 1 });
schema.index({ publication: 1, kind: 1, occurredAt: 1 });
export default mongoose.model("MembershipContentEvent", schema);
