import mongoose from "mongoose";

const creatorProfileSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    bio: { type: String, default: "" },
    category: { type: String, default: "" },
    monthlyPrice: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model("CreatorProfile", creatorProfileSchema);
