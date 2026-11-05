import mongoose from "mongoose";

const schema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  actorRole: { type: String, enum: ["MAIN_ADMIN", "MODERATOR", "FINANCE"], required: true },
  action: { type: String, required: true, trim: true, maxlength: 120, index: true },
  targetType: { type: String, required: true, trim: true, maxlength: 80, index: true },
  targetId: { type: String, required: true, trim: true, maxlength: 120, index: true },
  reason: { type: String, required: true, trim: true, maxlength: 2000 },
  before: { type: mongoose.Schema.Types.Mixed, default: null },
  after: { type: mongoose.Schema.Types.Mixed, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
}, { timestamps: { createdAt: true, updatedAt: false }, strict: "throw" });

schema.index({ createdAt: -1 });
schema.index({ targetType: 1, targetId: 1, createdAt: -1 });
for (const operation of ["updateOne", "updateMany", "findOneAndUpdate", "deleteOne", "deleteMany", "findOneAndDelete"]) {
  schema.pre(operation, function immutableAuditEvent() { throw new Error("Admin audit events are immutable"); });
}

export default mongoose.model("AdminAuditEvent", schema);
