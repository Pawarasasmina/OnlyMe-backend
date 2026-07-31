import mongoose from "mongoose";
import { CONTENT_ACTIONS, CONTENT_STATUSES } from "../constants/contentConstants.js";

const schema = new mongoose.Schema({
  content: { type: mongoose.Schema.Types.ObjectId, ref: "Content", required: true, index: true },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  action: { type: String, enum: CONTENT_ACTIONS, required: true },
  previousStatus: { type: String, enum: CONTENT_STATUSES, required: true },
  newStatus: { type: String, enum: CONTENT_STATUSES, required: true },
  admin: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  creatorVisibleMessage: { type: String, trim: true, default: "", maxlength: 2000 },
  internalNote: { type: String, trim: true, default: "", maxlength: 2000 },
  reasonCodes: [{ type: String, trim: true, maxlength: 80 }],
  transitionId: { type: String, required: true, unique: true },
}, { timestamps: { createdAt: true, updatedAt: false } });
schema.index({ content: 1, createdAt: -1 });
for (const operation of ["updateOne", "updateMany", "findOneAndUpdate", "deleteOne", "deleteMany", "findOneAndDelete"]) {
  schema.pre(operation, function preventHistoryMutation() { throw new Error("Content review history is immutable"); });
}
export default mongoose.model("ContentReviewHistory", schema);
