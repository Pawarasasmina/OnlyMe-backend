import mongoose from "mongoose";

const contentSchema = new mongoose.Schema(
  {
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    status: { type: String, default: "draft" },
    accessLevel: { type: String, default: "subscribers" },
  },
  { timestamps: true }
);

export default mongoose.model("Content", contentSchema);
