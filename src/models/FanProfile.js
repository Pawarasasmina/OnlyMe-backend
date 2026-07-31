import mongoose from "mongoose";

const fanProfileSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    coverPhoto: { type: String, default: "" },
    bio: { type: String, default: "", maxlength: 300 },
    interests: [{ type: String, trim: true, maxlength: 40 }],
    discoveryPreferences: {
      showMe: { type: String, enum: ["men", "women", "everyone"], default: "everyone" },
      creatorVibe: { type: String, enum: ["fresh", "established", "mature", "any"], default: "any" },
      contentDepth: { type: String, enum: ["quick", "deep", "both"], default: "both" },
      discoveryRange: { type: String, enum: ["city", "country", "global"], default: "global" },
      creatorStyle: { type: String, enum: ["practical", "personal", "aspirational", "educational", "any"], default: "any" },
    },
    orbitStatus: { type: String, default: "", maxlength: 80 },
    city: { type: String, default: "", maxlength: 80 },
    country: { type: String, default: "", maxlength: 80 },
    profileVisibility: { type: String, enum: ["public", "private"], default: "private" },
    privacySettings: {
      showOnlineStatus: { type: Boolean, default: true },
      showActivityStatus: { type: Boolean, default: true },
      showLocation: { type: Boolean, default: false },
      allowDiscovery: { type: Boolean, default: true },
      allowDirectMessages: { type: Boolean, default: true },
      allowMentions: { type: Boolean, default: true },
    },
    preferredLanguage: { type: String, default: "en" },
    timezone: { type: String, default: "UTC" },
    notificationPreferences: {
      email: { type: Boolean, default: true },
      inApp: { type: Boolean, default: true },
      marketing: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

fanProfileSchema.index({ profileVisibility: 1 });
fanProfileSchema.index({ city: 1, country: 1 });
fanProfileSchema.index({ profileVisibility: 1, "privacySettings.allowDiscovery": 1, city: 1, country: 1 });
fanProfileSchema.index({ interests: 1 });

export default mongoose.model("FanProfile", fanProfileSchema);
