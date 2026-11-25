import mongoose from "mongoose";

const protectedUsernameSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, lowercase: true, index: true },
  kind: { type: String, enum: ["PLATFORM", "BRAND", "VERIFIED_HANDLE"], default: "PLATFORM", index: true },
  protectedUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  reason: { type: String, required: true, trim: true, maxlength: 1000 },
  active: { type: Boolean, default: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  disabledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  disabledAt: { type: Date, default: null },
}, { timestamps: true });

protectedUsernameSchema.index({ active: 1, kind: 1, createdAt: -1 });

export default mongoose.model("ProtectedUsername", protectedUsernameSchema);
