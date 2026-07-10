import mongoose from "mongoose";

const subscriptionSchema = new mongoose.Schema(
  {
    fan: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, default: "pending" },
  },
  { timestamps: true }
);

export default mongoose.model("Subscription", subscriptionSchema);
