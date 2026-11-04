import mongoose from "mongoose";
import PlatformSetting from "./PlatformSetting.js";

export const PUBLICATION_REPORT_REASONS = [
  "SPAM",
  "FALSE_INFORMATION",
  "DEFAMATION",
  "HARASSMENT",
  "HATE",
  "NUDITY",
  "SEXUAL_CONTENT",
  "VIOLENCE",
  "SELF_HARM",
  "ILLEGAL_CONTENT",
  "COPYRIGHT",
  "SCAM",
  "IMPERSONATION",
  "CHILD_SAFETY",
  "OTHER",
];

const publicationReportSchema = new mongoose.Schema(
  {
    publication: { type: mongoose.Schema.Types.ObjectId, ref: "Publication", required: true, index: true },
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    kind: { type: String, enum: ["SEEN", "WORLD", "PREMIUM_WORLD"], required: true, index: true },
    reason: { type: String, enum: PUBLICATION_REPORT_REASONS, required: true },
    reasonLabel: { type: String, trim: true, maxlength: 80, default: "" },
    details: { type: String, trim: true, maxlength: 1000, default: "" },
    status: { type: String, enum: ["RECEIVED", "REVIEWING", "RESOLVED", "CLOSED"], default: "RECEIVED", index: true },
    source: { type: String, enum: ["USER_REPORT", "UPLOAD_SCAN", "DIRECT_ACCESS_DISPUTE"], default: "USER_REPORT", index: true },
    priority: { type: String, enum: ["URGENT", "STANDARD"], default: "STANDARD", index: true },
    priorityRank: { type: Number, default: 1, index: true },
    dueAt: { type: Date, default: null, index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: { type: Date, default: null },
    resolution: { action: { type: String, default: "" }, note: { type: String, default: "", maxlength: 2000 } },
    snapshot: {
      title: { type: String, trim: true, default: "" },
      summary: { type: String, trim: true, default: "" },
      creatorId: { type: String, trim: true, default: "" },
      publishedAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

publicationReportSchema.index({ publication: 1, reporter: 1, status: 1 });
publicationReportSchema.index({ status: 1, createdAt: -1 });
publicationReportSchema.index({ creator: 1, status: 1, createdAt: -1 });
publicationReportSchema.pre("validate", async function applySla() {
  if (!this.isNew) return;
  const urgent = ["CHILD_SAFETY", "SELF_HARM", "DEFAMATION"].includes(this.reason);
  const settings = await PlatformSetting.findOne({ key: "moderation-policy" }).select("value").lean();
  const urgentHours = Math.min(24, Math.max(1, Number(settings?.value?.urgentHours) || 4));
  const standardHours = Math.min(168, Math.max(1, Number(settings?.value?.standardHours) || 24));
  this.priority = urgent ? "URGENT" : "STANDARD";
  this.priorityRank = urgent ? 2 : 1;
  this.dueAt = new Date(Date.now() + (urgent ? urgentHours : standardHours) * 60 * 60 * 1000);
  this.$locals.wasNew = true;
  this.$locals.autoHide = (settings?.value?.autoHideCategories || ["CHILD_SAFETY", "SELF_HARM", "DEFAMATION"]).includes(this.reason);
});
publicationReportSchema.post("save", async function autoHideUrgent(doc) {
  if (!doc.$locals.wasNew || !doc.$locals.autoHide) return;
  const { default: Publication } = await import("./Publication.js");
  await Publication.updateOne({ _id: doc.publication }, { $set: { status: "ARCHIVED", archivedAt: new Date() } });
});

export default mongoose.model("PublicationReport", publicationReportSchema);
