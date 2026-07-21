import mongoose from "mongoose";

const profileRelationshipSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    target: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: ["FOLLOW", "SEE_SIGNAL"], required: true },
  },
  { timestamps: true }
);

profileRelationshipSchema.index({ actor: 1, target: 1, type: 1 }, { unique: true });
profileRelationshipSchema.index({ target: 1, type: 1, createdAt: -1 });

export default mongoose.model("ProfileRelationship", profileRelationshipSchema);
