import mongoose from "mongoose";
import { ACCESS_LEVELS, CONTENT_STATUSES, CONTENT_TYPES } from "../constants/contentConstants.js";

const mediaSchema = new mongoose.Schema({
  assetId: { type: String, trim: true, required: true }, resourceType: { type: String, enum: ["image", "video"], required: true },
  mediaType: { type: String, enum: ["IMAGE", "VIDEO", "AUDIO"], required: true }, secureUrl: { type: String, trim: true, required: true },
  format: { type: String, trim: true, lowercase: true }, bytes: { type: Number, min: 0 }, width: { type: Number, min: 0 }, height: { type: Number, min: 0 }, duration: { type: Number, min: 0 },
  isPrimary: { type: Boolean, default: false }, sortOrder: { type: Number, min: 0, default: 0 }, uploadState: { type: String, enum: ["VERIFIED", "PENDING", "FAILED"], default: "VERIFIED" }, createdAt: { type: Date, default: Date.now },
}, { _id: false });
const legacyImageSchema = new mongoose.Schema({ publicId: { type: String, required: true }, url: { type: String, required: true }, width: Number, height: Number, format: String, bytes: Number, isMain: { type: Boolean, default: false } }, { _id: false });

const contentSchema = new mongoose.Schema({
  creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  title: { type: String, required: true, trim: true, maxlength: 120 }, topic: { type: String, trim: true, maxlength: 120 },
  description: { type: String, trim: true, default: "", maxlength: 2000 }, body: { type: String, default: "", maxlength: 10000 },
  contentType: { type: String, enum: [...CONTENT_TYPES, "image"], default: "IMAGE" }, media: { type: [mediaSchema], default: [] }, thumbnail: { type: mediaSchema, default: undefined },
  category: { type: String, trim: true, default: "", maxlength: 40 }, tags: [{ type: String, trim: true, lowercase: true, maxlength: 40 }], images: { type: [legacyImageSchema], default: undefined },
  status: { type: String, enum: [...CONTENT_STATUSES, "draft", "published"], default: "DRAFT", index: true }, publishedAt: { type: Date, default: null },
  accessLevel: { type: String, enum: [...ACCESS_LEVELS, "subscribers"], default: "SUBSCRIBER_ONLY" }, coinPrice: { type: Number, default: null, min: 1 },
  submittedAt: { type: Date, default: null }, reviewedAt: { type: Date, default: null }, reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  creatorFeedback: { type: String, trim: true, default: "", maxlength: 2000 }, internalModerationNote: { type: String, trim: true, default: "", maxlength: 2000, select: false },
  archivedAt: { type: Date, default: null }, statusVersion: { type: Number, default: 0, min: 0 }, lastTransitionId: { type: String, default: "" },
  legacyMigration: { version: { type: Number, default: null }, legacyPublished: { type: Boolean, default: false }, originalTitle: String, originalTopic: String, originalStatus: String, originalContentType: String, originalAccessLevel: String, migratedAt: Date },
}, { timestamps: true });
contentSchema.index({ creator: 1, status: 1, createdAt: -1 }); contentSchema.index({ status: 1, submittedAt: 1 }); contentSchema.index({ status: 1, publishedAt: -1 });
contentSchema.index({ contentType: 1 }); contentSchema.index({ accessLevel: 1 }); contentSchema.index({ category: 1 });
export default mongoose.model("Content", contentSchema);
