import mongoose from "mongoose";

const schema = new mongoose.Schema({
  _id: { type: String },
  value: { type: Number, required: true, default: 0 },
});

export default mongoose.model("MemberSequence", schema);
