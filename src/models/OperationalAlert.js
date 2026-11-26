import mongoose from "mongoose";
const schema = new mongoose.Schema({
  eventKey: { type: String, required: true, unique: true },
  type: { type: String, enum: ["REPORT_SPIKE", "CHARGEBACK_SPIKE", "PAYOUT_FAILURE", "DOWNTIME", "RECOVERY"], required: true, index: true },
  status: { type: String, enum: ["DELIVERED", "FAILED"], required: true },
  message: { type: String, maxlength: 1000, required: true },
  providerId: { type: String, default: "" },
  error: { type: String, maxlength: 1000, default: "" },
}, { timestamps: true });
export default mongoose.model("OperationalAlert", schema);
