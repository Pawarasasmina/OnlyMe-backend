import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    clientMessageId: { type: String, trim: true, maxlength: 100, default: null },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    mediaType: { type: String, enum: ["text", "image", "video", "audio", "gift"], default: "text" },
    gift: {
      giftId: { type: mongoose.Schema.Types.ObjectId, ref: "Gift", default: null },
      name: { type: String, trim: true, maxlength: 80, default: "" },
      stars: { type: Number, min: 1, default: undefined },
      imageUrl: { type: String, maxlength: 2000, default: "" },
      displayScale: { type: Number, min: 40, max: 140, default: undefined },
      imagePositionX: { type: Number, min: -50, max: 50, default: 0 },
      imagePositionY: { type: Number, min: -50, max: 50, default: 0 },
    },
    image: {
      assetId: { type: String, default: "" },
      resourceType: { type: String, default: "" },
      format: { type: String, default: "" },
      bytes: { type: Number, default: 0 },
      width: { type: Number, default: 0 },
      height: { type: Number, default: 0 },
    },
    audio: {
      assetId: { type: String, default: "" },
      resourceType: { type: String, default: "" },
      format: { type: String, default: "" },
      bytes: { type: Number, default: 0 },
      duration: { type: Number, default: 0 },
      waveform: { type: [Number], default: undefined },
    },
    video: {
      assetId: { type: String, default: "" },
      resourceType: { type: String, default: "" },
      format: { type: String, default: "" },
      bytes: { type: Number, default: 0 },
      duration: { type: Number, default: 0 },
      width: { type: Number, default: 0 },
      height: { type: Number, default: 0 },
    },
    ppm: { type: Boolean, default: false },
    messageChannel: { type: String, enum: ["STANDARD", "DIRECT_ACCESS"], default: "STANDARD" },
    messageKind: { type: String, enum: ["USER_MESSAGE", "CREATOR_ASK", "FAN_FREE_ASK"], default: "USER_MESSAGE" },
    directAccessWindow: { type: mongoose.Schema.Types.ObjectId, ref: "DAWindow", default: null },
    readAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    deletedFor: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
    forwardedFrom: { type: mongoose.Schema.Types.ObjectId, default: null },
    sharedAttachment: {
      contentType: { type: String, enum: ["NOTE", "WORLD"], default: undefined },
      contentId: { type: mongoose.Schema.Types.ObjectId, default: null },
      title: { type: String, trim: true, maxlength: 180, default: "" },
      previewImage: { type: String, maxlength: 1000, default: "" },
      author: { id: { type: mongoose.Schema.Types.ObjectId, default: null }, name: { type: String, maxlength: 120, default: "" }, username: { type: String, maxlength: 80, default: "" } },
      fallbackText: { type: String, trim: true, maxlength: 500, default: "" },
    },
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
    sharedContent: {
      contentType: { type: String, enum: ["", "feed_post", "seen", "world", "experience", "profile", "story"], default: "" },
      contentId: { type: mongoose.Schema.Types.ObjectId, default: null },
      route: { type: String, trim: true, maxlength: 240, default: "" },
      title: { type: String, trim: true, maxlength: 160, default: "" },
      previewText: { type: String, trim: true, maxlength: 300, default: "" },
      imageUrl: { type: String, trim: true, maxlength: 600, default: "" },
      author: {
        id: { type: mongoose.Schema.Types.ObjectId, default: null },
        name: { type: String, trim: true, maxlength: 120, default: "" },
        username: { type: String, trim: true, maxlength: 60, default: "" },
        avatarUrl: { type: String, trim: true, maxlength: 600, default: "" },
      },
    },
  },
  { timestamps: true }
);

messageSchema.index({ sender: 1, recipient: 1, createdAt: -1 });
messageSchema.index(
  { sender: 1, clientMessageId: 1 },
  { unique: true, partialFilterExpression: { clientMessageId: { $type: "string" } } },
);
messageSchema.index({ recipient: 1, readAt: 1, createdAt: -1 });
messageSchema.index({ replyTo: 1 });
messageSchema.index({ directAccessWindow: 1, createdAt: 1 });
messageSchema.index({ "sharedContent.contentType": 1, "sharedContent.contentId": 1, createdAt: -1 });

export default mongoose.model("Message", messageSchema);
