import mongoose from "mongoose";

const storySchema = new mongoose.Schema({
  creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  caption: { type: String, trim: true, maxlength: 300, default: "" },
  image: {
    assetId: { type: String, required: true },
    url: { type: String, required: true },
    resourceType: { type: String, enum: ["image", "video", "raw"], default: "image" },
  },
  mediaType: { type: String, enum: ["image", "video"], default: "image" },
  duration: { type: Number, min: 1, max: 60, default: 5 },
  editorMetadata: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({
      transform: { scale: 1, translateX: 0, translateY: 0, rotation: 0 },
      textOverlays: [],
      stickers: [],
      drawing: [],
    }),
  },
  audience: { type: String, enum: ["everyone", "followers", "close_circle", "only_me"], default: "everyone" },
  allowReactions: { type: Boolean, default: true },
  allowReplies: { type: Boolean, default: true },
  allowSharing: { type: Boolean, default: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

storySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
storySchema.index({ creator: 1, createdAt: -1 });

export default mongoose.model("Story", storySchema);
