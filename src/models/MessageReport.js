import mongoose from "mongoose";
import PlatformSetting from "./PlatformSetting.js";

const messageReportSchema = new mongoose.Schema({
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required() { return this.source !== "UPLOAD_SCAN"; }, default: null, index: true },
  reportedUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  scope: { type: String, enum: ["MESSAGE", "GROUP_MESSAGE", "CONVERSATION", "FEED_POST", "COMMENT", "PROFILE", "PROFILE_MEDIA", "SEEN", "CHAPTER", "WORLD", "STORY", "GIFT", "DIRECT_ACCESS"], required: true },
  message: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
  groupMessage: { type: mongoose.Schema.Types.ObjectId, ref: "GroupMessage", default: null },
  chatGift: { type: mongoose.Schema.Types.ObjectId, ref: "ChatGift", default: null },
  dreamGift: { type: mongoose.Schema.Types.ObjectId, ref: "DreamGift", default: null },
  feedPost: { type: mongoose.Schema.Types.ObjectId, ref: "FeedPost", default: null },
  publication: { type: mongoose.Schema.Types.ObjectId, ref: "Publication", default: null },
  profileMedia: { type: mongoose.Schema.Types.ObjectId, ref: "ProfileMedia", default: null },
  story: { type: mongoose.Schema.Types.ObjectId, ref: "Story", default: null },
  commentId: { type: mongoose.Schema.Types.ObjectId, default: null },
  chapterId: { type: String, trim: true, default: null },
  directAccessWindow: { type: mongoose.Schema.Types.ObjectId, ref: "DAWindow", default: null },
  reason: {
    type: String,
    enum: ["SPAM", "FALSE_INFORMATION", "DEFAMATION", "HARASSMENT", "HATE", "NUDITY", "SEXUAL_CONTENT", "VIOLENCE", "SELF_HARM", "ILLEGAL_CONTENT", "COPYRIGHT", "IMPERSONATION", "CHILD_SAFETY", "SCAM", "OTHER"],
    required: true,
  },
  details: { type: String, trim: true, maxlength: 1000, default: "" },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true, select: false },
  status: { type: String, enum: ["RECEIVED", "REVIEWING", "RESOLVED", "CLOSED"], default: "RECEIVED", index: true },
  source: { type: String, enum: ["USER_REPORT", "UPLOAD_SCAN", "DIRECT_ACCESS_DISPUTE"], default: "USER_REPORT", index: true },
  priority: { type: String, enum: ["URGENT", "STANDARD"], default: "STANDARD", index: true },
  priorityRank: { type: Number, default: 1, index: true },
  dueAt: { type: Date, default: null, index: true },
  autoHiddenAt: { type: Date, default: null },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  reviewingAt: { type: Date, default: null },
  resolvedAt: { type: Date, default: null },
  resolution: {
    action: { type: String, enum: ["NO_ACTION", "HIDDEN", "REMOVED", "WARNING", "POSTING_RESTRICTED", "SELLING_RESTRICTED", "MESSAGING_RESTRICTED", "ACCOUNT_RESTRICTED", "SUSPENDED", "BANNED", "RESTRICTION_LIFTED"], default: null },
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
messageReportSchema.index({ status: 1, priorityRank: -1, dueAt: 1, createdAt: 1 });
messageReportSchema.pre("validate", async function applySla() {
  if (!this.isNew) return;
  this.$locals.wasNew = true;
  const urgent = ["CHILD_SAFETY", "SELF_HARM", "DEFAMATION"].includes(this.reason);
  const settings = await PlatformSetting.findOne({ key: "moderation-policy" }).select("value").lean();
  const urgentHours = Math.min(24, Math.max(1, Number(settings?.value?.urgentHours) || 4));
  const standardHours = Math.min(168, Math.max(1, Number(settings?.value?.standardHours) || 24));
  this.priority = urgent ? "URGENT" : "STANDARD";
  this.priorityRank = urgent ? 2 : 1;
  this.dueAt = new Date(Date.now() + (urgent ? urgentHours : standardHours) * 60 * 60 * 1000);
  this.$locals.autoHide = (settings?.value?.autoHideCategories || ["CHILD_SAFETY", "SELF_HARM", "DEFAMATION"]).includes(this.reason);
});
messageReportSchema.post("save", async function autoHideUrgent(doc) {
  if (!doc.$locals.wasNew || !doc.$locals.autoHide || doc.autoHiddenAt) return;
  if (doc.feedPost) { const { default: FeedPost } = await import("./FeedPost.js"); await FeedPost.updateOne({ _id: doc.feedPost }, { $set: { status: "archived", archivedAt: new Date() } }); }
  if (doc.publication) { const { default: Publication } = await import("./Publication.js"); await Publication.updateOne({ _id: doc.publication }, { $set: { status: "ARCHIVED", archivedAt: new Date() } }); }
  if (doc.story) { const { default: Story } = await import("./Story.js"); await Story.updateOne({ _id: doc.story }, { $set: { audience: "only_me" } }); }
  if (doc.message) { const { default: Message } = await import("./Message.js"); await Message.updateOne({ _id: doc.message }, { $set: { deletedAt: new Date() } }); }
  if (doc.groupMessage) { const { default: GroupMessage } = await import("./GroupMessage.js"); await GroupMessage.updateOne({ _id: doc.groupMessage }, { $set: { deletedAt: new Date() } }); }
  if (doc.commentId && doc.feedPost) { const { default: FeedPost } = await import("./FeedPost.js"); await FeedPost.updateOne({ _id: doc.feedPost, "comments._id": doc.commentId }, { $set: { "comments.$.deletedAt": new Date() } }); }
  if (doc.scope === "PROFILE" && doc.reportedUser) { const { default: User } = await import("./User.js"); await User.updateOne({ _id: doc.reportedUser }, { $set: { profileModerationHiddenAt: new Date() } }); }
  await mongoose.model("MessageReport").updateOne({ _id: doc._id }, { $set: { autoHiddenAt: new Date() } });
});
messageReportSchema.index({ reporter: 1, groupMessage: 1 }, { unique: true, partialFilterExpression: { scope: "GROUP_MESSAGE" } });
messageReportSchema.index({ reporter: 1, feedPost: 1 }, { unique: true, partialFilterExpression: { scope: "FEED_POST" } });
messageReportSchema.index({ reporter: 1, commentId: 1 }, { unique: true, partialFilterExpression: { scope: "COMMENT" } });
messageReportSchema.index({ reporter: 1, publication: 1, chapterId: 1 }, { unique: true, partialFilterExpression: { scope: "CHAPTER" } });
messageReportSchema.index({ reporter: 1, directAccessWindow: 1 }, { unique: true, partialFilterExpression: { scope: "DIRECT_ACCESS" } });
messageReportSchema.index({ reporter: 1, reportedUser: 1, scope: 1 }, { unique: true, partialFilterExpression: { scope: "PROFILE" } });
messageReportSchema.index({ reporter: 1, profileMedia: 1 }, { unique: true, partialFilterExpression: { scope: "PROFILE_MEDIA" } });
messageReportSchema.index({ reporter: 1, publication: 1 }, { unique: true, partialFilterExpression: { scope: "SEEN" } });
messageReportSchema.index({ reporter: 1, publication: 1 }, { unique: true, partialFilterExpression: { scope: "WORLD" }, name: "reporter_publication_world_unique" });
messageReportSchema.index({ reporter: 1, story: 1 }, { unique: true, partialFilterExpression: { scope: "STORY" } });
messageReportSchema.index({ reporter: 1, chatGift: 1 }, { unique: true, partialFilterExpression: { scope: "GIFT", chatGift: { $type: "objectId" } } });
messageReportSchema.index({ reporter: 1, dreamGift: 1 }, { unique: true, partialFilterExpression: { scope: "GIFT", dreamGift: { $type: "objectId" } } });

export default mongoose.model("MessageReport", messageReportSchema);
