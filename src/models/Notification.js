import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, default: "system" },
    title: { type: String, required: true },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("Notification", notificationSchema);
