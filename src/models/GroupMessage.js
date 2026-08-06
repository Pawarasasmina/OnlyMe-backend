import mongoose from "mongoose";

const groupMessageSchema = new mongoose.Schema({
  group: { type: mongoose.Schema.Types.ObjectId, ref: "GroupConversation", required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  clientMessageId: { type: String, trim: true, maxlength: 100, default: null },
  body: { type: String, required: true, trim: true, maxlength: 2000 },
  mediaType: { type: String, enum: ["text", "image", "video", "audio"], default: "text" },
  image: { assetId: String, resourceType: String, format: String, bytes: Number, width: Number, height: Number },
  audio: { assetId: String, resourceType: String, format: String, bytes: Number, duration: Number, waveform: [Number] },
  video: { assetId: String, resourceType: String, format: String, bytes: Number, duration: Number, width: Number, height: Number },
  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "GroupMessage", default: null },
  forwardedFrom: { type: mongoose.Schema.Types.ObjectId, default: null },
  sharedAttachment: {
    contentType: { type: String, enum: ["NOTE", "WORLD"], default: undefined }, contentId: { type: mongoose.Schema.Types.ObjectId, default: null },
    title: { type: String, maxlength: 180, default: "" }, previewImage: { type: String, maxlength: 1000, default: "" },
    author: { id: { type: mongoose.Schema.Types.ObjectId, default: null }, name: { type: String, maxlength: 120, default: "" }, username: { type: String, maxlength: 80, default: "" } },
    fallbackText: { type: String, maxlength: 500, default: "" },
  },
  reactions: { type: [{ user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, emoji: { type: String, required: true, maxlength: 8 }, reactedAt: { type: Date, default: Date.now } }], default: [] },
  deliveredBy: { type: [{ user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, deliveredAt: { type: Date, default: Date.now } }], default: [] },
  readBy: { type: [{ user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, readAt: { type: Date, default: Date.now } }], default: [] },
  deletedAt: { type: Date, default: null },
  deletedFor: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
}, { timestamps: true });

groupMessageSchema.index({ group: 1, createdAt: -1 });
groupMessageSchema.index({ group: 1, sender: 1, clientMessageId: 1 }, { unique: true, partialFilterExpression: { clientMessageId: { $type: "string" } } });

export default mongoose.model("GroupMessage", groupMessageSchema);
