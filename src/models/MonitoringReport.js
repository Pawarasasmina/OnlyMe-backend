import mongoose from "mongoose";
const schema = new mongoose.Schema({
  periodEnd: { type: Date, required: true, unique: true },
  periodStart: { type: Date, required: true },
  summary: { type: mongoose.Schema.Types.Mixed, required: true },
  createdAt: { type: Date, default: Date.now },
}, { strict: "throw" });
export default mongoose.model("MonitoringReport", schema);
