import mongoose from "mongoose";

export const SAVED_ITEM_TARGET_TYPES = ["place", "journey", "book", "comment"];
export const SAVED_ITEM_TARGET_MODELS = [
  "OrbitCityProgress",
  "Place",
  "OrbitDream",
  "Content",
  "FeedPostComment",
  "SeenEngagement",
  "WallEngagement",
  "WallShareEngagement",
];

const savedItemSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    targetType: { type: String, enum: SAVED_ITEM_TARGET_TYPES, required: true, index: true },
    targetModel: { type: String, enum: SAVED_ITEM_TARGET_MODELS, required: true, index: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  },
  { timestamps: true },
);

savedItemSchema.index(
  { user: 1, targetType: 1, targetModel: 1, targetId: 1 },
  { unique: true, name: "unique_saved_item_target_per_user" },
);
savedItemSchema.index(
  { user: 1, targetType: 1, createdAt: -1 },
  { name: "list_saved_items_by_user_type" },
);

export default mongoose.model("SavedItem", savedItemSchema);
