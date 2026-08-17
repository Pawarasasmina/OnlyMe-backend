import mongoose from "mongoose";

export const PUBLICATION_REPORT_REASONS = [
  "SPAM",
  "FALSE_INFORMATION",
  "HARASSMENT",
  "HATE",
  "NUDITY",
  "ILLEGAL_CONTENT",
  "COPYRIGHT",
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

export default mongoose.model("PublicationReport", publicationReportSchema);
