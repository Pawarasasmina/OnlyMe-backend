import mongoose from "mongoose";
const schema = new mongoose.Schema({
  business: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  offer: { type: mongoose.Schema.Types.ObjectId, ref: "FeedPost", required: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  service: { type: String, required: true, maxlength: 160 },
  scheduledAt: { type: Date, required: true },
  price: { type: Number, required: true, min: 1 }, currency: { type: String, required: true, match: /^[A-Z]{3}$/ },
  status: { type: String, enum: ["REQUESTED", "CONFIRMED", "CANCELLED", "COMPLETED", "DISPUTED"], default: "REQUESTED" },
  dispute: { reason: { type: String, maxlength: 2000 }, openedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, openedAt: Date, resolution: { type: String, maxlength: 2000 }, resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, resolvedAt: Date },
}, { timestamps: true });
schema.index({ customer: 1, offer: 1, scheduledAt: 1 }, { unique: true });
export default mongoose.model("BusinessBooking", schema);
