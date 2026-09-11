import mongoose from "mongoose";

const profileMediaSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: ["image", "video"], required: true },
    url: { type: String, required: true },
    thumbnailUrl: { type: String, default: "" },
    assetId: { type: String, required: true },
    resourceType: { type: String, enum: ["image", "video"], required: true },
    mimeType: { type: String, required: true, trim: true, lowercase: true },
    format: { type: String, trim: true, lowercase: true, default: "" },
    width: { type: Number, min: 0, default: 0 },
    height: { type: Number, min: 0, default: 0 },
    duration: { type: Number, min: 0, default: 0 },
    size: { type: Number, min: 0, default: 0 },
    caption: { type: String, trim: true, maxlength: 160, default: "" },
    likedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    sortOrder: { type: Number, default: 0 },
    sourceType: { type: String, enum: ["direct", "story", "seen"], default: "direct" },
    sourceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    sourceMediaId: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

profileMediaSchema.index({ user: 1, sortOrder: -1, createdAt: -1 });
profileMediaSchema.index({ user: 1, _id: 1 });
profileMediaSchema.index({ _id: 1, likedBy: 1 });
profileMediaSchema.index(
  { user: 1, sourceType: 1, sourceId: 1, sourceMediaId: 1 },
  { unique: true, partialFilterExpression: { sourceType: { $in: ["story", "seen"] }, sourceId: { $type: "objectId" }, sourceMediaId: { $type: "string", $ne: "" } } },
);

export default mongoose.model("ProfileMedia", profileMediaSchema);
