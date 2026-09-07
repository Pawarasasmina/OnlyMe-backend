import mongoose from "mongoose";

const placeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120, index: true },
    slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 160, index: true },
    description: { type: String, trim: true, maxlength: 1000, default: "" },
    city: { type: String, trim: true, maxlength: 80, default: "", index: true },
    country: { type: String, trim: true, maxlength: 80, default: "", index: true },
    address: { type: String, trim: true, maxlength: 240, default: "" },
    coordinates: {
      lat: { type: Number, min: -90, max: 90, default: null },
      lng: { type: Number, min: -180, max: 180, default: null },
    },
    image: { type: String, trim: true, default: "" },
    category: { type: String, trim: true, maxlength: 60, default: "Place" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    status: { type: String, enum: ["active", "archived", "removed"], default: "active", index: true },
  },
  { timestamps: true },
);

placeSchema.index({ slug: 1 }, { unique: true });
placeSchema.index({ name: "text", city: "text", country: "text", address: "text", category: "text" });
placeSchema.index({ city: 1, country: 1, name: 1 });

export default mongoose.model("Place", placeSchema);
