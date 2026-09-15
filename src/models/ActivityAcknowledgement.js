import mongoose from "mongoose";

const schema = new mongoose.Schema({
  eventKey: { type: String, required: true, unique: true, maxlength: 180 },
  acknowledgedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  acknowledgedAt: { type: Date, required: true },
}, { timestamps: true });

export default mongoose.model("ActivityAcknowledgement", schema);
