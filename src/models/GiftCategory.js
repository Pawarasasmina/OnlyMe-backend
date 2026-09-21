import mongoose from "mongoose";

const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 60 },
  slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 80, unique: true },
  sortOrder: { type: Number, default: 0, min: 0, max: 100000, validate: Number.isSafeInteger },
  isActive: { type: Boolean, default: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

schema.index({ isActive: 1, sortOrder: 1, name: 1 });
export default mongoose.model("GiftCategory", schema);
