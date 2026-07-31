import mongoose from "mongoose";

const verificationFileCleanupSchema = new mongoose.Schema(
  {
    storageKey: { type: String, required: true },
    quarantinedStorageKey: { type: String, default: "" },
    reason: { type: String, required: true, maxlength: 100 },
    status: { type: String, enum: ["PREPARED", "QUARANTINED", "FAILED"], default: "PREPARED", index: true },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: "", maxlength: 1000 },
  },
  { timestamps: true }
);

verificationFileCleanupSchema.index({ createdAt: 1 });
export default mongoose.model("VerificationFileCleanup", verificationFileCleanupSchema);
