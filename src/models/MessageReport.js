import mongoose from "mongoose";

const messageReportSchema = new mongoose.Schema({
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  reportedUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  scope: { type: String, enum: ["MESSAGE", "GROUP_MESSAGE", "CONVERSATION", "FEED_POST", "PROFILE", "PROFILE_MEDIA", "SEEN", "WORLD", "STORY", "GIFT"], required: true },
  message: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
  groupMessage: { type: mongoose.Schema.Types.ObjectId, ref: "GroupMessage", default: null },
  chatGift: { type: mongoose.Schema.Types.ObjectId, ref: "ChatGift", default: null },
  dreamGift: { type: mongoose.Schema.Types.ObjectId, ref: "DreamGift", default: null },
  feedPost: { type: mongoose.Schema.Types.ObjectId, ref: "FeedPost", default: null },
  publication: { type: mongoose.Schema.Types.ObjectId, ref: "Publication", default: null },
  profileMedia: { type: mongoose.Schema.Types.ObjectId, ref: "ProfileMedia", default: null },
  story: { type: mongoose.Schema.Types.ObjectId, ref: "Story", default: null },
  reason: {
    type: String,
    enum: ["SPAM", "FALSE_INFORMATION", "HARASSMENT", "HATE", "NUDITY", "SEXUAL_CONTENT", "VIOLENCE", "ILLEGAL_CONTENT", "COPYRIGHT", "SCAM", "OTHER"],
    required: true,
  },
  details: { type: String, trim: true, maxlength: 1000, default: "" },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true, select: false },
  status: { type: String, enum: ["RECEIVED", "REVIEWING", "RESOLVED", "CLOSED"], default: "RECEIVED", index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  reviewingAt: { type: Date, default: null },
  resolvedAt: { type: Date, default: null },
  resolution: {
    action: { type: String, enum: ["NO_ACTION", "WARNING", "MESSAGING_RESTRICTED", "ACCOUNT_RESTRICTED", "RESTRICTION_LIFTED"], default: null },
    note: { type: String, trim: true, maxlength: 2000, default: "" },
    restrictionUntil: { type: Date, default: null },
    restrictionLiftedAt: { type: Date, default: null },
    restrictionLiftedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    restrictionLiftNote: { type: String, trim: true, maxlength: 2000, default: "" },
  },
}, { timestamps: true });

messageReportSchema.index(
  { reporter: 1, message: 1 },
  { unique: true, partialFilterExpression: { scope: "MESSAGE" } },
);
messageReportSchema.index({ status: 1, createdAt: 1 });
messageReportSchema.index({ reporter: 1, groupMessage: 1 }, { unique: true, partialFilterExpression: { scope: "GROUP_MESSAGE" } });
messageReportSchema.index({ reporter: 1, feedPost: 1 }, { unique: true, partialFilterExpression: { scope: "FEED_POST" } });
messageReportSchema.index({ reporter: 1, reportedUser: 1, scope: 1 }, { unique: true, partialFilterExpression: { scope: "PROFILE" } });
messageReportSchema.index({ reporter: 1, profileMedia: 1 }, { unique: true, partialFilterExpression: { scope: "PROFILE_MEDIA" } });
messageReportSchema.index({ reporter: 1, publication: 1 }, { unique: true, partialFilterExpression: { scope: "SEEN" } });
messageReportSchema.index({ reporter: 1, publication: 1 }, { unique: true, partialFilterExpression: { scope: "WORLD" }, name: "reporter_publication_world_unique" });
messageReportSchema.index({ reporter: 1, story: 1 }, { unique: true, partialFilterExpression: { scope: "STORY" } });
messageReportSchema.index({ reporter: 1, chatGift: 1 }, { unique: true, partialFilterExpression: { scope: "GIFT", chatGift: { $type: "objectId" } } });
messageReportSchema.index({ reporter: 1, dreamGift: 1 }, { unique: true, partialFilterExpression: { scope: "GIFT", dreamGift: { $type: "objectId" } } });

export default mongoose.model("MessageReport", messageReportSchema);
