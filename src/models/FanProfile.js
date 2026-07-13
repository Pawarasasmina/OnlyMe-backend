import mongoose from "mongoose";

const fanProfileSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    bio: { type: String, default: "", maxlength: 300 },
    profileVisibility: { type: String, enum: ["public", "private"], default: "private" },
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

export default mongoose.model("FanProfile", fanProfileSchema);
