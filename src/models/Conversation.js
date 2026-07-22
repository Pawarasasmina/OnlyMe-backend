import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema({
  fan: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  status: { type: String, enum: ["REQUEST", "ACTIVE", "DECLINED"], required: true, default: "REQUEST" },
  acceptedAt: { type: Date, default: null },
  acceptedByCreator: { type: Boolean, default: false },
  requestStartedAt: { type: Date, default: null },
  declinedAt: { type: Date, default: null },
}, { timestamps: true });

conversationSchema.index({ fan: 1, creator: 1 }, { unique: true });
conversationSchema.index({ creator: 1, status: 1, updatedAt: -1 });

export default mongoose.model("Conversation", conversationSchema);
