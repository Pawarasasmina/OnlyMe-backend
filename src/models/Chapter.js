import mongoose from "mongoose";
import { BLOCK_TYPES } from "../constants/publicationConstants.js";

const mediaSchema = new mongoose.Schema({ assetId: { type: String, required: true }, resourceType: { type: String, enum: ["image", "video"], required: true }, mediaType: { type: String, enum: ["IMAGE", "VIDEO", "AUDIO", "VOICE"], required: true }, secureUrl: { type: String, required: true }, format: String, bytes: Number, width: Number, height: Number, duration: Number }, { _id: false });
const blockSchema = new mongoose.Schema({ id: { type: String, required: true }, type: { type: String, enum: BLOCK_TYPES, required: true }, order: { type: Number, min: 0, required: true }, text: { type: String, default: "" }, media: { type: mediaSchema, default: undefined }, url: { type: String, default: "" }, label: { type: String, default: "" }, metadata: { type: mongoose.Schema.Types.Mixed, default: undefined } }, { _id: false });
const schema = new mongoose.Schema({ publication: { type: mongoose.Schema.Types.ObjectId, ref: "Publication", required: true }, stableChapterId: { type: String, required: true }, order: { type: Number, min: 0, required: true }, title: { type: String, trim: true, required: true, maxlength: 120 }, blocks: { type: [blockSchema], default: [] }, isPreview: { type: Boolean, default: false }, releaseMode: { type: String, enum: ["IMMEDIATE", "SCHEDULED"], default: "IMMEDIATE" }, releaseAt: { type: Date, default: null }, draftVersion: { type: Number, default: 1, min: 1 } }, { timestamps: true });
schema.index({ publication: 1, order: 1 }, { unique: true });
schema.index({ publication: 1, stableChapterId: 1 }, { unique: true });
export default mongoose.model("Chapter", schema);
