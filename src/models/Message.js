import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    mediaType: { type: String, enum: ["text", "image", "video", "audio"], default: "text" },
    ppm: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
    reactions: {
      type: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        emoji: { type: String, required: true, maxlength: 8 },
        reactedAt: { type: Date, default: Date.now },
      }],
      default: [],
    },
    storyReply: {
      story: { type: mongoose.Schema.Types.ObjectId, ref: "Story", default: null },
      imageUrl: { type: String, default: "" },
      caption: { type: String, default: "", maxlength: 300 },
      expiresAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

messageSchema.index({ sender: 1, recipient: 1, createdAt: -1 });
messageSchema.index({ recipient: 1, readAt: 1, createdAt: -1 });
messageSchema.index({ replyTo: 1 });

export default mongoose.model("Message", messageSchema);
