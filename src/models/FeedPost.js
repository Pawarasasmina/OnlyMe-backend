import mongoose from "mongoose";
import { POST_CONTEXTS, POST_REACTIONS, POST_STATUSES, POST_VISIBILITIES } from "../constants/postConstants.js";

const postMediaSchema = new mongoose.Schema(
  {
    assetId: { type: String, trim: true, required: true },
    url: { type: String, trim: true, required: true },
    type: { type: String, enum: ["image"], default: "image" },
    format: { type: String, trim: true, lowercase: true },
    bytes: { type: Number, min: 0 },
    width: { type: Number, min: 0 },
    height: { type: Number, min: 0 },
    sortOrder: { type: Number, min: 0, default: 0 },
    originalName: { type: String, trim: true, default: "" },
  },
  { _id: true }
);

const postReactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reaction: { type: String, enum: POST_REACTIONS, required: true },
  },
  { timestamps: true }
);

const postCommentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, trim: true, required: true, maxlength: 500 },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const postSaveSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

const postViewSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    viewedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const postShareSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    caption: { type: String, trim: true, maxlength: 500, default: "" },
  },
  { timestamps: true }
);

const postHiddenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reason: { type: String, trim: true, maxlength: 80, default: "NOT_USEFUL" },
  },
  { timestamps: true }
);

const postReportSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reason: { type: String, trim: true, maxlength: 80, required: true },
    details: { type: String, trim: true, maxlength: 1000, default: "" },
    status: { type: String, enum: ["RECEIVED", "REVIEWING", "RESOLVED", "CLOSED"], default: "RECEIVED" },
  },
  { timestamps: true }
);

const feedPostSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    text: { type: String, trim: true, default: "", maxlength: 2000 },
    context: { type: String, enum: ["", ...POST_CONTEXTS], default: "" },
    location: { type: String, trim: true, default: "", maxlength: 120 },
    media: { type: [postMediaSchema], default: [] },
    visibility: { type: String, enum: POST_VISIBILITIES, default: "public" },
    status: { type: String, enum: POST_STATUSES, default: "published", index: true },
    reactions: { type: [postReactionSchema], default: [] },
    comments: { type: [postCommentSchema], default: [] },
    saves: { type: [postSaveSchema], default: [] },
    views: { type: [postViewSchema], default: [] },
    shares: { type: [postShareSchema], default: [] },
    hiddenBy: { type: [postHiddenSchema], default: [] },
    reports: { type: [postReportSchema], default: [] },
    supportCount: { type: Number, min: 0, default: 0 },
    commentCount: { type: Number, min: 0, default: 0 },
    saveCount: { type: Number, min: 0, default: 0 },
    viewCount: { type: Number, min: 0, default: 0 },
    shareCount: { type: Number, min: 0, default: 0 },
    seedSource: { type: String, trim: true, default: "", index: true },
    seedKey: { type: String, trim: true, default: "", index: true },
    deletedAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

feedPostSchema.index({ status: 1, publishedAt: -1, createdAt: -1 });
feedPostSchema.index({ author: 1, status: 1, updatedAt: -1 });
feedPostSchema.index({ context: 1 });
feedPostSchema.index({ status: 1, visibility: 1, deletedAt: 1, publishedAt: -1 });
feedPostSchema.index({ context: 1, location: 1 });
feedPostSchema.index({ "saves.user": 1, status: 1, publishedAt: -1 });
feedPostSchema.index({ "views.user": 1, status: 1, publishedAt: -1 });
feedPostSchema.index({ "shares.user": 1, status: 1, publishedAt: -1 });
feedPostSchema.index({ "shares.createdAt": -1, status: 1, deletedAt: 1 });
feedPostSchema.index({ "hiddenBy.user": 1, status: 1, publishedAt: -1 });

export default mongoose.model("FeedPost", feedPostSchema);
