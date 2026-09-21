import mongoose from "mongoose";

const financialSettingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, enum: ["STAR_EXCHANGE_RATE"] },
  starsPerUsd: { type: Number, required: true, min: 0.01, max: 100000 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });

export default mongoose.model("FinancialSetting", financialSettingSchema);
