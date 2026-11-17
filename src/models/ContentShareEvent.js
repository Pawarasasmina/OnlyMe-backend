import mongoose from "mongoose";

export const SHARE_ROUTES = ["CHAT", "STORY", "COPY_LINK", "WHATSAPP", "TELEGRAM", "MESSAGES", "SYSTEM_SHARE"];

const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  contentType: { type: String, enum: ["feed_post", "seen"], required: true, index: true },
  contentId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  firstRoute: { type: String, enum: SHARE_ROUTES, required: true },
  routes: [{ type: String, enum: SHARE_ROUTES }],
  lastSharedAt: { type: Date, default: Date.now },
}, { timestamps: true });

schema.index({ user: 1, contentType: 1, contentId: 1 }, { unique: true, name: "unique_private_share_per_person_item" });
schema.index({ owner: 1, contentType: 1, createdAt: -1 });

export default mongoose.model("ContentShareEvent", schema);
