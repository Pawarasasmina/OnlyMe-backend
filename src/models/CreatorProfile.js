import mongoose from "mongoose";

const creatorProfileSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    coverPhoto: { type: String, default: "" },
    bio: { type: String, default: "", maxlength: 500 },
    categories: [{ type: String, trim: true }],
    category: { type: String, default: "" },
    city: { type: String, default: "", maxlength: 80 },
    country: { type: String, default: "", maxlength: 80 },
    socialLinks: [
      {
        platform: { type: String, trim: true, maxlength: 40 },
        url: { type: String, trim: true, maxlength: 300 },
      },
    ],
    subscriptionPriceCents: { type: Number, default: 300, min: 300, max: 99999 },
    monthlyPrice: { type: Number, default: 3 },
    nsfwEnabled: { type: Boolean, default: false },
    freePreviewEnabled: { type: Boolean, default: true },
    messagingEnabled: { type: Boolean, default: true },
    ppmEnabled: { type: Boolean, default: false },
    ppmPrice: { type: Number, default: 10, min: 10, max: 1000 },
    profileVisibility: { type: String, enum: ["public", "private"], default: "public" },
    preferredLanguage: { type: String, default: "en" },
    timezone: { type: String, default: "UTC" },
    notificationPreferences: {
      email: { type: Boolean, default: true },
      inApp: { type: Boolean, default: true },
      marketing: { type: Boolean, default: false },
    },
    verificationStatus: {
      type: String,
      enum: ["not_submitted", "pending", "verified", "rejected"],
      default: "not_submitted",
    },
  },
  { timestamps: true }
);

creatorProfileSchema.index({ profileVisibility: 1 });

export default mongoose.model("CreatorProfile", creatorProfileSchema);
