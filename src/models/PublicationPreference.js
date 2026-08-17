import mongoose from "mongoose";

export const PUBLICATION_PREFERENCE_TYPES = ["HIDDEN_SEEN", "MUTED_CREATOR"];

const publicationPreferenceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    publication: { type: mongoose.Schema.Types.ObjectId, ref: "Publication", default: null, index: true },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    type: { type: String, enum: PUBLICATION_PREFERENCE_TYPES, required: true, index: true },
    reason: { type: String, trim: true, maxlength: 80, default: "" },
  },
  { timestamps: true }
);

publicationPreferenceSchema.index(
  { user: 1, publication: 1, type: 1 },
  { unique: true, partialFilterExpression: { type: "HIDDEN_SEEN" } }
);
publicationPreferenceSchema.index(
  { user: 1, creator: 1, type: 1 },
  { unique: true, partialFilterExpression: { type: "MUTED_CREATOR" } }
);

export default mongoose.model("PublicationPreference", publicationPreferenceSchema);
