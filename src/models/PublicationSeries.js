import mongoose from "mongoose";
import { PUBLICATION_LIMITS } from "../constants/publicationConstants.js";

const publicationSeriesSchema = new mongoose.Schema(
  {
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: PUBLICATION_LIMITS.seriesName },
    normalizedName: { type: String, required: true, lowercase: true, trim: true, maxlength: PUBLICATION_LIMITS.seriesName, index: true },
    archivedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true },
);

publicationSeriesSchema.index(
  { creator: 1, normalizedName: 1 },
  { unique: true, partialFilterExpression: { archivedAt: null } },
);

export default mongoose.model("PublicationSeries", publicationSeriesSchema);
