import multer from "multer";
import { env } from "../config/env.js";
import ApiError from "../utils/ApiError.js";

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

export const uploadVerificationDocument = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: env.verificationMaxFileSize },
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new ApiError(400, "Only JPEG, PNG, WebP, or PDF files are allowed"));
      return;
    }
    callback(null, true);
  },
});
