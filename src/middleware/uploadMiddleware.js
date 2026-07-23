import multer from "multer";
import path from "node:path";
import ApiError from "../utils/ApiError.js";
import { env } from "../config/env.js";

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const basename = path
      .basename(file.originalname, extension)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40);

    callback(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${basename || "upload"}${extension}`);
  },
});

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function imageFileFilter(_req, file, callback) {
  if (!allowedImageTypes.has(file.mimetype)) {
    callback(new ApiError(400, "Only JPEG, PNG, or WebP images are allowed"));
    return;
  }

  callback(null, true);
}

export const upload = multer({ storage });
export const uploadProfileImage = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});
export const uploadCoverImage = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 8 * 1024 * 1024 },
});

const allowedContentTypes = new Set([
  "image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime",
  "audio/mpeg", "audio/wav", "audio/x-wav", "audio/aac", "audio/flac", "audio/x-flac",
  "audio/webm", "audio/ogg", "audio/mp4", "audio/x-m4a",
]);
export const uploadContentMedia = multer({
  storage,
  limits: { files: 1, fileSize: env.contentMaxFileSize },
  fileFilter: (_req, file, callback) => {
    if (!allowedContentTypes.has(file.mimetype)) return callback(new ApiError(400, "Unsupported content media type"));
    callback(null, true);
  },
});

const allowedVoiceTypes = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav"]);
export const uploadVoiceMessage = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!allowedVoiceTypes.has(file.mimetype)) return callback(new ApiError(400, "Unsupported voice recording format"));
    callback(null, true);
  },
});
