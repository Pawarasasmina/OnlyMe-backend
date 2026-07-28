import mongoose from "mongoose";

const userBlockSchema = new mongoose.Schema({
  blocker: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  blocked: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
}, { timestamps: true });

userBlockSchema.index({ blocker: 1, blocked: 1 }, { unique: true });
userBlockSchema.index({ blocked: 1, blocker: 1 });

export default mongoose.model("UserBlock", userBlockSchema);
