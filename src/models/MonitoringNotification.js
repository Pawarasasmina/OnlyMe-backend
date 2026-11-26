import mongoose from "mongoose";
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true }, recipient: { type: String, required: true },
  subject: { type: String, required: true }, text: { type: String, required: true },
  deliveredAt: { type: Date, default: null }, attempts: { type: Number, default: 0 },
  cancelledAt: { type: Date, default: null },
  nextAttemptAt: { type: Date, default: Date.now }, leaseUntil: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now, expires: 30 * 86400 },
}, { strict: "throw" });
export default mongoose.model("MonitoringNotification", schema);
