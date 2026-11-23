import mongoose from "mongoose";

const schema = new mongoose.Schema({
  campaign: { type: mongoose.Schema.Types.ObjectId, ref: "CreatorAnnouncement", required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  email: { type: String, trim: true, lowercase: true, default: "" },
  name: { type: String, trim: true, default: "" },
  username: { type: String, trim: true, default: "" },
  status: { type: String, enum: ["PENDING", "PROCESSING", "COMPLETED"], default: "PENDING", index: true },
  inAppDeliveredAt: { type: Date, default: null },
  emailDeliveredAt: { type: Date, default: null },
  emailProviderId: { type: String, default: "" },
  emailSkippedReason: { type: String, default: "" },
  emailError: { type: String, maxlength: 500, default: "" },
  processedAt: { type: Date, default: null },
}, { timestamps: true });

schema.index({ campaign: 1, user: 1 }, { unique: true });
schema.index({ campaign: 1, status: 1 });
export default mongoose.model("CreatorAnnouncementRecipient", schema);
