import mongoose from "mongoose";

const usernameReservationSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, lowercase: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });

export default mongoose.model("UsernameReservation", usernameReservationSchema);
