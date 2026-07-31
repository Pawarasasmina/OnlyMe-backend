import mongoose from "mongoose";

const searchHistorySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    query: { type: String, required: true, trim: true, maxlength: 100 },
    normalizedQuery: { type: String, required: true, trim: true, lowercase: true, maxlength: 100 },
    selectedType: {
      type: String,
      enum: ["all", "people", "worlds", "seens", "posts", "places", "journeys", "saved"],
      default: "all",
    },
    useCount: { type: Number, min: 1, default: 1 },
    lastUsedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

searchHistorySchema.index({ user: 1, lastUsedAt: -1 });
searchHistorySchema.index({ user: 1, normalizedQuery: 1, selectedType: 1 }, { unique: true });
searchHistorySchema.index({ normalizedQuery: 1, lastUsedAt: -1 });

export default mongoose.model("SearchHistory", searchHistorySchema);
