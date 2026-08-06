import mongoose from "mongoose";

const groupConversationSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 60 },
  avatar: { type: String, default: "" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  members: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], required: true },
  admins: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], required: true },
  permissions: {
    editGroupInfo: { type: String, enum: ["ADMINS", "ALL_MEMBERS"], default: "ADMINS" },
    addMembers: { type: String, enum: ["ADMINS", "ALL_MEMBERS"], default: "ADMINS" },
  },
  archivedBy: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
  mutedBy: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

groupConversationSchema.index({ members: 1, updatedAt: -1 });

export default mongoose.model("GroupConversation", groupConversationSchema);
