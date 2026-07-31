import mongoose from "mongoose";

const userBlockSchema = new mongoose.Schema(
  {
    blocker: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    blocked: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    reason: { type: String, trim: true, default: "", maxlength: 120 },
  },
  { timestamps: true }
);

userBlockSchema.index({ blocker: 1, blocked: 1 }, { unique: true });

export default mongoose.model("UserBlock", userBlockSchema);
