import mongoose from "mongoose";

const emailTemplateSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, enum: ["WELCOME"] },
  subject: { type: String, trim: true, maxlength: 160, default: "Welcome to @seen — we see you" },
  heading: { type: String, trim: true, maxlength: 160, default: "We see you, {{firstName}}." },
  message: { type: String, trim: true, maxlength: 1200, default: "Your space is ready. Discover people, moments, and worlds that feel relevant to you." },
  buttonLabel: { type: String, trim: true, maxlength: 80, default: "Start discovering" },
  footer: { type: String, trim: true, maxlength: 500, default: "@seen — We see you. Every day." },
  logo: { assetId: { type: String, default: "" }, url: { type: String, default: "" } },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });

export default mongoose.model("EmailTemplate", emailTemplateSchema);
