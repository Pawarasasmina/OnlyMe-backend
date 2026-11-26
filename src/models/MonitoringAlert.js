import mongoose from "mongoose";
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  surface: String, route: String, errorType: String,
  count: { type: Number, default: 0 },
  state: { type: String, enum: ["open", "acknowledged"], default: "open" },
  firstSeenAt: { type: Date, default: Date.now }, lastSeenAt: { type: Date, default: Date.now },
}, { strict: "throw" });
schema.index({ lastSeenAt: 1 }, { expireAfterSeconds: 30 * 86400 });
export default mongoose.model("MonitoringAlert", schema);
