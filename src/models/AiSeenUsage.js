import mongoose from "mongoose";

const sessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true },
  publication: { type: mongoose.Schema.Types.ObjectId, ref: "Publication", default: null },
  attemptsUsed: { type: Number, default: 0, min: 0, max: 3 },
  answerRevisionsUsed: { type: Number, default: 0, min: 0, max: 1 },
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null },
}, { _id: false });

const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  dateKey: { type: String, required: true },
  baseLimit: { type: Number, required: true, min: 1, max: 3 },
  startedCount: { type: Number, default: 0, min: 0, max: 3 },
  publishedBonusCount: { type: Number, default: 0, min: 0, max: 3 },
  bonusPublicationIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Publication" }],
  sessions: { type: [sessionSchema], default: [] },
}, { timestamps: true });

schema.index({ user: 1, dateKey: 1 }, { unique: true });
schema.index({ "sessions.sessionId": 1 }, { sparse: true });

export default mongoose.model("AiSeenUsage", schema);
