import mongoose from "mongoose";

const dailyEncounterSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    targetUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reasonCode: { type: String, trim: true, default: "RELEVANT_CREATOR" },
    reasonText: { type: String, trim: true, required: true, maxlength: 140 },
    encounterDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  },
  { timestamps: true }
);

dailyEncounterSchema.index({ user: 1, encounterDate: 1 }, { unique: true });

export default mongoose.model("DailyEncounter", dailyEncounterSchema);
