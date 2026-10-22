import mongoose from "mongoose";
const entry = new mongoose.Schema({ key: String, textHash: String, createdAt: Date }, { _id: false });
export default mongoose.model("WallCreationLedger", new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  entries: { type: [entry], default: [] },
}));
