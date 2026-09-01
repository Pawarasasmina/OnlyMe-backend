import mongoose from "mongoose";

const schema = new mongoose.Schema({
  publication: { type: mongoose.Schema.Types.ObjectId, ref: "Publication", required: true },
  chapterId: { type: String, required: true, maxlength: 100 },
  blockId: { type: String, required: true, maxlength: 80 },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  optionIndex: { type: Number, required: true, min: 0, max: 3 },
}, { timestamps: true });

schema.index({ publication: 1, chapterId: 1, blockId: 1, user: 1 }, { unique: true });
schema.index({ publication: 1, chapterId: 1, blockId: 1, optionIndex: 1 });

export default mongoose.model("PublicationPollVote", schema);
