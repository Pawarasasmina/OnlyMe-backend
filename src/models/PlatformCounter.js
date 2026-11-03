import mongoose from "mongoose";

const platformCounterSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: Number, required: true, default: 0 },
}, { timestamps: true });

export default mongoose.model("PlatformCounter", platformCounterSchema);
