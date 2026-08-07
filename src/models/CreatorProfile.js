import mongoose from "mongoose";

const creatorProfileSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    coverPhoto: { type: String, default: "" },
    bio: { type: String, default: "", maxlength: 500 },
    orbitQuote: { type: String, default: "", maxlength: 240 },
    categories: [{ type: String, trim: true }],
    category: { type: String, default: "" },
    discoveryPreferences: {
      showMe: { type: String, enum: ["men", "women", "everyone"], default: "everyone" },
      creatorVibe: { type: String, enum: ["fresh", "established", "mature", "any"], default: "any" },
      contentDepth: { type: String, enum: ["quick", "deep", "both"], default: "both" },
      discoveryRange: { type: String, enum: ["city", "country", "global"], default: "global" },
      creatorStyle: { type: String, enum: ["practical", "personal", "aspirational", "educational", "any"], default: "any" },
    },
    discoverSettings: {
      recommendations: { type: Boolean, default: true },
      peopleNearby: { type: Boolean, default: true },
      risingCreators: { type: Boolean, default: true },
      newCreators: { type: Boolean, default: true },
      languages: [{ type: String, trim: true, maxlength: 40 }],
      preferredCity: { type: String, trim: true, maxlength: 80, default: "" },
      topics: [
        {
          label: { type: String, trim: true, maxlength: 40 },
          preference: { type: String, enum: ["interested", "less", "neutral"], default: "neutral" },
        },
      ],
      hiddenCreators: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      updatedAt: { type: Date, default: null },
    },
    orbitStatus: { type: String, default: "", maxlength: 80 },
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
    directAccessEnabled: { type: Boolean, default: true },
    directAccessPriceStars: { type: Number, default: 100, min: 10, max: 10000, validate: Number.isSafeInteger },
    directCallEnabled: { type: Boolean, default: false },
    directCallPriceStars: { type: Number, default: 500, enum: [100, 300, 500, 800, 1500] },
    directCallDurationMinutes: { type: Number, default: 5, enum: [2, 5, 10, 15, 20, 30] },
    directCallAutoDeclineAway: { type: Boolean, default: false },
    ppmEnabled: { type: Boolean, default: false },
    ppmPrice: { type: Number, default: 10, min: 10, max: 1000 },
    profileVisibility: { type: String, enum: ["public", "private"], default: "public" },
    privacySettings: {
      showOnlineStatus: { type: Boolean, default: true },
      showActivityStatus: { type: Boolean, default: true },
      showLocation: { type: Boolean, default: true },
      allowDiscovery: { type: Boolean, default: true },
      allowDirectMessages: { type: Boolean, default: true },
      allowMentions: { type: Boolean, default: true },
      allowTags: { type: Boolean, default: true },
      showFollowers: { type: Boolean, default: true },
    },
    preferredLanguage: { type: String, default: "en" },
    timezone: { type: String, default: "UTC" },
    notificationPreferences: {
      email: { type: Boolean, default: true },
      inApp: { type: Boolean, default: true },
      marketing: { type: Boolean, default: false },
      messages: { type: Boolean, default: true },
      directAccess: { type: Boolean, default: true },
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
creatorProfileSchema.index({ profileVisibility: 1, "privacySettings.allowDiscovery": 1, city: 1, country: 1 });
creatorProfileSchema.index({ category: 1, categories: 1 });

export default mongoose.model("CreatorProfile", creatorProfileSchema);
