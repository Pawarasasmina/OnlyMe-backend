import mongoose from "mongoose";
import { ACTIVE_PLANET_STATUSES, PUBLICATION_KINDS, PUBLICATION_STATUSES } from "../constants/publicationConstants.js";

const mediaSchema = new mongoose.Schema({ assetId: { type: String, required: true }, resourceType: { type: String, enum: ["image", "video"], required: true }, mediaType: { type: String, enum: ["IMAGE", "VIDEO", "AUDIO", "VOICE"], required: true }, secureUrl: { type: String, required: true }, format: String, bytes: Number, width: Number, height: Number, duration: Number }, { _id: false });
const snapshotSchema = new mongoose.Schema({ version: { type: Number, required: true }, metadata: { type: mongoose.Schema.Types.Mixed, required: true }, chapters: { type: [mongoose.Schema.Types.Mixed], required: true }, frozenAt: { type: Date, required: true } }, { _id: false });

const schema = new mongoose.Schema({
  creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  kind: { type: String, enum: PUBLICATION_KINDS, required: true }, title: { type: String, trim: true, default: "", maxlength: 120 }, summary: { type: String, trim: true, default: "", maxlength: 300 }, description: { type: String, trim: true, default: "", maxlength: 2000 }, category: { type: String, trim: true, default: "", maxlength: 40 }, tags: [{ type: String, trim: true, lowercase: true, maxlength: 40 }],
  coverMedia: { type: mediaSchema, default: undefined }, introMedia: { type: mediaSchema, default: undefined },
  planet: { emoji: { type: String, default: "" }, slot: { type: String, enum: ["WORLD_1", "WORLD_2", "PREMIUM", null], default: null }, accent: { type: String, default: "" } },
  pricing: { mode: { type: String, enum: ["FREE", "ONE_TIME", "MONTHLY"], required: true }, starsAmount: { type: Number, default: null }, presetId: { type: String, default: null } },
  previewPolicy: { type: String, enum: ["ALL_FREE", "ONE_CHAPTER", "ONE_OR_TWO_CHAPTERS"], required: true },
  status: { type: String, enum: PUBLICATION_STATUSES, default: "DRAFT", index: true }, draftVersion: { type: Number, default: 1, min: 1 }, submittedVersion: { type: Number, default: null }, publishedVersion: { type: Number, default: null }, statusVersion: { type: Number, default: 0, min: 0 },
  submittedSnapshot: { type: snapshotSchema, default: undefined, select: false }, publishedSnapshot: { type: snapshotSchema, default: undefined },
  submittedAt: Date, reviewedAt: Date, reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }, creatorVisibleFeedback: { type: String, default: "", maxlength: 2000 }, internalModerationNote: { type: String, default: "", maxlength: 2000, select: false }, publishedAt: Date, archivedAt: Date, lastTransitionId: { type: String, default: "" },
  legacySource: { contentId: { type: mongoose.Schema.Types.ObjectId, ref: "Content" }, classification: String }, migration: { version: Number, analyzedAt: Date },
}, { timestamps: true });

schema.index({ creator: 1, kind: 1, status: 1 });
schema.index({ kind: 1, status: 1, publishedAt: -1 });
schema.index({ creator: 1, status: 1, updatedAt: -1 });
schema.index({ status: 1, submittedAt: 1 });
schema.index({ category: 1, kind: 1, status: 1 });
schema.index({ creator: 1, "planet.slot": 1 }, { unique: true, partialFilterExpression: { status: { $in: ACTIVE_PLANET_STATUSES }, "planet.slot": { $type: "string" } } });
schema.index({ creator: 1, kind: 1 }, { unique: true, partialFilterExpression: { kind: "PREMIUM_WORLD", status: { $in: ACTIVE_PLANET_STATUSES } } });
export default mongoose.model("Publication", schema);
