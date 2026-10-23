import mongoose from "mongoose";

const storyArchiveSchema = new mongoose.Schema({
  creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  storyId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, index: true },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  storyCreatedAt: { type: Date, required: true },
}, { timestamps: true });

storyArchiveSchema.index({ creator: 1, storyCreatedAt: -1 });

export default mongoose.model("StoryArchive", storyArchiveSchema);
