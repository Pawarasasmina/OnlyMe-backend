import mongoose from "mongoose";

const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  stars: { type: Number, required: true, min: 1, max: 1000000, validate: Number.isSafeInteger },
  image: {
    assetId: { type: String, required: true },
    url: { type: String, required: true },
    format: { type: String, required: true },
    bytes: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
  },
  displayScale: { type: Number, default: 100, min: 40, max: 140, validate: Number.isSafeInteger },
  imagePositionX: { type: Number, default: 0, min: -50, max: 50, validate: Number.isSafeInteger },
  imagePositionY: { type: Number, default: 0, min: -50, max: 50, validate: Number.isSafeInteger },
  sortOrder: { type: Number, default: 0, min: 0, max: 100000, validate: Number.isSafeInteger },
  isActive: { type: Boolean, default: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

schema.index({ isActive: 1, sortOrder: 1, createdAt: 1 });
export default mongoose.model("Gift", schema);
