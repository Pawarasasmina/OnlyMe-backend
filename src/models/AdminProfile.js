import mongoose from "mongoose";

const adminProfileSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    phoneNumber: { type: String, default: "", maxlength: 40 },
    preferredLanguage: { type: String, default: "en" },
    timezone: { type: String, default: "UTC" },
    notificationPreferences: {
      email: { type: Boolean, default: true },
      inApp: { type: Boolean, default: true },
      security: { type: Boolean, default: true },
    },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("AdminProfile", adminProfileSchema);
