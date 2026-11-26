import mongoose from "mongoose";
const schema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true },
  alertKey: { type: String, default: null, index: true },
  source: { type: String, enum: ["client", "server", "watchdog"], required: true },
  surface: { type: String, enum: ["web", "ios", "android", "api", "watchdog"], required: true },
  kind: { type: String, enum: ["error", "request", "screen", "uptime", "heartbeat"], required: true },
  route: { type: String, maxlength: 300, default: "/" },
  errorType: { type: String, maxlength: 80, default: "" },
  frames: { type: [String], default: [] },
  status: { type: Number, min: 0, max: 599, default: 0 },
  durationMs: { type: Number, min: 0, max: 120000, default: 0 },
  timedOut: { type: Boolean, default: false },
  release: { type: String, maxlength: 80, default: "" },
  createdAt: { type: Date, default: Date.now, expires: 30 * 86400 },
}, { strict: "throw" });
schema.index({ createdAt: -1, kind: 1, surface: 1 });
export default mongoose.model("MonitoringEvent", schema);
