import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema({
  fan: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  participants: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
  participantKey: { type: String, trim: true, default: null },
  requestRecipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  archivedBy: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
  mutedBy: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
  status: { type: String, enum: ["REQUEST", "ACTIVE", "DECLINED"], required: true, default: "REQUEST" },
  acceptedAt: { type: Date, default: null },
  acceptedByCreator: { type: Boolean, default: false },
  requestStartedAt: { type: Date, default: null },
  declinedAt: { type: Date, default: null },
}, { timestamps: true });

conversationSchema.index({ fan: 1, creator: 1 }, { unique: true });
conversationSchema.index({ participantKey: 1 }, { unique: true, partialFilterExpression: { participantKey: { $type: "string" } } });
conversationSchema.index({ participants: 1, updatedAt: -1 });
conversationSchema.index({ creator: 1, status: 1, updatedAt: -1 });

export default mongoose.model("Conversation", conversationSchema);
