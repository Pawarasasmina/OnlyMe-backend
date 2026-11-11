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
    isAnimated: { type: Boolean, default: false },
  },
  displayScale: { type: Number, default: 100, min: 40, max: 140, validate: Number.isSafeInteger },
  imagePositionX: { type: Number, default: 0, min: -50, max: 50, validate: Number.isSafeInteger },
  imagePositionY: { type: Number, default: 0, min: -50, max: 50, validate: Number.isSafeInteger },
  idleMotion: { type: String, enum: ["beat", "sway", "hover", "floaty", "glowp", "rev", "spin", "coin", "flick", "bob2", "pulse"], default: "hover" },
  motionDelay: { type: Number, default: 0, min: 0, max: 8, validate: Number.isSafeInteger },
  showShine: { type: Boolean, default: false },
  showHalo: { type: Boolean, default: false },
  celebrationTier: { type: String, enum: ["AUTO", "SMALL", "MID", "BIG", "LEGENDARY", "VAULT"], default: "AUTO" },
  effectFamily: { type: String, enum: ["glass", "fash", "mech", "energy", "launch", "celebr", "lux", "royal", "soft"], default: "glass" },
  objectEffect: { type: String, enum: ["none", "car", "moto", "boatx", "laptop", "guitar", "volt", "fire", "drone", "watch", "phones", "camera", "rocketx", "moon", "chessx", "trophy", "bottle", "heartglass", "neon", "ring", "lux", "royal", "jetx", "spin360"], default: "none" },
  animationConfigured: { type: Boolean, default: false },
  category: { type: mongoose.Schema.Types.ObjectId, ref: "GiftCategory", default: null, index: true },
  sortOrder: { type: Number, default: 0, min: 0, max: 100000, validate: Number.isSafeInteger },
  isActive: { type: Boolean, default: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

schema.index({ isActive: 1, sortOrder: 1, createdAt: 1 });
export default mongoose.model("Gift", schema);
