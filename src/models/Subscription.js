import mongoose from "mongoose";

const subscriptionSchema = new mongoose.Schema(
  {
    fan: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, default: "pending" },
    startedAt: { type: Date, default: null },
    nextRenewalAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    priceCents: { type: Number, default: null },
    trialStatus: { type: String, default: "" },
    gracePeriod: { type: Boolean, default: false },
    autoRenew: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("Subscription", subscriptionSchema);
