import mongoose from "mongoose";

export const ANALYTICS_EVENT_TYPES = [
  "SESSION_STARTED",
  "SESSION_ENDED",
  "LOGIN",
  "LOGOUT",
  "PROFILE_VIEW",
  "SEARCH_PERFORMED",
  "SEARCH_RESULT_CLICKED",
  "CONTENT_IMPRESSION",
  "CONTENT_VIEW",
  "CONTENT_OPENED",
  "REACTION",
  "COMMENT",
  "SAVE",
  "SHARE",
  "FOLLOW",
  "STORY_VIEW",
  "SEEN_VIEW",
  "SUBSCRIPTION_STARTED",
  "SUPPORT_COMPLETED",
];

const analyticsEventSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sessionId: { type: String, required: true, trim: true, maxlength: 80, index: true },
    eventType: { type: String, enum: ANALYTICS_EVENT_TYPES, required: true, index: true },
    entityType: { type: String, trim: true, maxlength: 40, default: "", index: true },
    entityId: { type: String, trim: true, maxlength: 80, default: "", index: true },
    source: { type: String, trim: true, maxlength: 40, default: "" },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    dedupeKey: { type: String, trim: true, maxlength: 220, default: undefined },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

analyticsEventSchema.index({ eventType: 1, createdAt: -1 });
analyticsEventSchema.index({ userId: 1, createdAt: -1 });
analyticsEventSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
analyticsEventSchema.index({ sessionId: 1, createdAt: -1 });
analyticsEventSchema.index({ eventType: 1, "metadata.normalizedQuery": 1, createdAt: -1 });
analyticsEventSchema.index({ eventType: 1, entityId: 1, createdAt: -1 });
analyticsEventSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });

export default mongoose.model("AnalyticsEvent", analyticsEventSchema);
