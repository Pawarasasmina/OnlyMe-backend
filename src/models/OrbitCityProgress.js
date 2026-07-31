import mongoose from "mongoose";

const orbitCityProgressSchema = new mongoose.Schema(
  {
    city: { type: String, required: true, trim: true, maxlength: 80 },
    country: { type: String, required: true, trim: true, maxlength: 80 },
    countryCode: { type: String, required: true, trim: true, uppercase: true, maxlength: 4 },
    currentCount: { type: Number, required: true, min: 0 },
    targetCount: { type: Number, required: true, min: 1 },
    sortOrder: { type: Number, default: 0, index: true },
    source: { type: String, enum: ["seeded_launch_config"], default: "seeded_launch_config" },
    enabled: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

orbitCityProgressSchema.index({ city: 1, country: 1 }, { unique: true });

export default mongoose.model("OrbitCityProgress", orbitCityProgressSchema);
