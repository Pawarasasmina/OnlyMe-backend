import mongoose from "mongoose";

const scoreSchema = new mongoose.Schema({ key: { type: String, required: true, maxlength: 80 }, score: { type: Number, required: true, default: 0 }, positive: { type: Number, default: 0 }, negative: { type: Number, default: 0 }, signals: { type: mongoose.Schema.Types.Mixed, default: {} }, lastSignalAt: { type: Date, default: Date.now } }, { _id: false });

const userInterestProfileSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
  topicScores: { type: [scoreSchema], default: [] },
  creatorScores: { type: [scoreSchema], default: [] },
  formatScores: { type: [scoreSchema], default: [] },
  signalCount: { type: Number, default: 0, min: 0 },
  lastSignalAt: { type: Date, default: null },
  rebuiltAt: { type: Date, default: null },
  version: { type: Number, default: 1 },
}, { timestamps: true });

userInterestProfileSchema.index({ updatedAt: -1 });

export default mongoose.model("UserInterestProfile", userInterestProfileSchema);
