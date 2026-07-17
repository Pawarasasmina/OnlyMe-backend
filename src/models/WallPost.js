import mongoose from "mongoose";
const wallPostSchema = new mongoose.Schema({
  creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  text: { type: String, required: true, trim: true, maxlength: 1200 },
  context: { type: String, enum: ["RIGHT_NOW", "COFFEE", "NEED_HELP", "PLACE", "RESTAURANT", "BOOK", "MOVIE", "TRAVEL", "BUSINESS", "FITNESS", "WELLNESS", "LIFESTYLE", "BEAUTY"], default: "RIGHT_NOW" },
  location: { type: String, trim: true, maxlength: 100, default: "" },
  media: [{ assetId: String, url: String }],
  status: { type: String, enum: ["PUBLISHED", "REMOVED"], default: "PUBLISHED", index: true },
}, { timestamps: true });
wallPostSchema.index({ status: 1, createdAt: -1 });
export default mongoose.model("WallPost", wallPostSchema);
