import mongoose from "mongoose";

const highlightStorySchema = new mongoose.Schema({
  storyId: { type: mongoose.Schema.Types.ObjectId, ref: "Story", required: true },
  caption: { type: String, default: "" },
  image: { assetId: String, url: String, resourceType: String },
  mediaType: { type: String, enum: ["image", "video"], default: "image" },
  duration: { type: Number, min: 1, max: 60, default: 5 },
  editorMetadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  audience: { type: String, enum: ["everyone", "followers", "close_circle", "only_me"], default: "everyone" },
  sourceType: { type: String, enum: ["original", "seen"], default: "original" },
  sourceSeen: { type: mongoose.Schema.Types.ObjectId, ref: "Publication", default: null },
  storyCreatedAt: { type: Date, required: true },
}, { _id: false });

const storyHighlightSchema = new mongoose.Schema({
  creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 30 },
  coverStoryId: { type: mongoose.Schema.Types.ObjectId, required: true },
  stories: { type: [highlightStorySchema], validate: [(items) => items.length > 0 && items.length <= 100, "Select between 1 and 100 stories"] },
}, { timestamps: true });

storyHighlightSchema.index({ creator: 1, createdAt: 1 });

export default mongoose.model("StoryHighlight", storyHighlightSchema);
