import mongoose from "mongoose";
const storySchema = new mongoose.Schema({ creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true }, caption: { type: String, trim: true, maxlength: 300, default: "" }, image: { assetId: { type: String, required: true }, url: { type: String, required: true } }, expiresAt: { type: Date, required: true } }, { timestamps: true });
storySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
storySchema.index({ creator: 1, createdAt: -1 });
export default mongoose.model("Story", storySchema);
