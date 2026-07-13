import mongoose from "mongoose";

const contentSchema = new mongoose.Schema(
  {
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true },
    topic: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: "" },
    contentType: { type: String, enum: ["image"], default: "image" },
    images: {
      type: [
        {
          publicId: { type: String, required: true },
          url: { type: String, required: true },
          width: Number,
          height: Number,
          format: String,
          bytes: Number,
          isMain: { type: Boolean, default: false },
        },
      ],
      validate: {
        validator: (images) => images.length > 0 && images.length <= 10,
        message: "Content must contain between 1 and 10 images",
      },
    },
    status: { type: String, enum: ["draft", "published"], default: "draft" },
    publishedAt: { type: Date, default: null },
    accessLevel: { type: String, default: "subscribers" },
  },
  { timestamps: true }
);

export default mongoose.model("Content", contentSchema);
