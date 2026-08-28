import multer from "multer";
import path from "node:path";
import ApiError from "../utils/ApiError.js";
import { env } from "../config/env.js";
import { POST_ALLOWED_VOICE_TYPES, POST_MAX_IMAGE_SIZE, POST_MAX_IMAGES, POST_MAX_VOICE_NOTES } from "../constants/postConstants.js";

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
const allowedVoiceTypes = new Set(POST_ALLOWED_VOICE_TYPES);

function normalizedMimeType(file) {
  return String(file?.mimetype || "").toLowerCase().split(";")[0].trim();
}

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
  "image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime", "video/webm",
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

export const uploadFeedPostImages = multer({
  storage,
  limits: { files: POST_MAX_IMAGES, fileSize: POST_MAX_IMAGE_SIZE },
  fileFilter: imageFileFilter,
});

export const uploadFeedPostMedia = multer({
  storage,
  limits: { files: POST_MAX_IMAGES + POST_MAX_VOICE_NOTES, fileSize: Math.max(POST_MAX_IMAGE_SIZE, env.maxVoiceNoteSizeBytes) },
  fileFilter: (_req, file, callback) => {
    const mimeType = normalizedMimeType(file);
    if (file.fieldname === "media") {
      if (!allowedImageTypes.has(mimeType)) return callback(new ApiError(400, "Only JPEG, PNG, or WebP images are allowed"));
      return callback(null, true);
    }
    if (file.fieldname === "voice") {
      if (!allowedVoiceTypes.has(mimeType)) return callback(new ApiError(400, "Unsupported voice recording format"));
      return callback(null, true);
    }
    return callback(new ApiError(400, "Unsupported post media field"));
  },
});

export const uploadVoiceMessage = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!allowedVoiceTypes.has(normalizedMimeType(file))) return callback(new ApiError(400, "Unsupported voice recording format"));
    callback(null, true);
  },
});

export const uploadVoiceTranscription = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: env.maxVoiceNoteSizeBytes },
  fileFilter: (_req, file, callback) => {
    if (!allowedVoiceTypes.has(normalizedMimeType(file))) return callback(new ApiError(400, "Unsupported voice recording format", "INVALID_AUDIO"));
    callback(null, true);
  },
});

const allowedVideoNoteTypes = new Set(["video/webm", "video/mp4", "video/quicktime"]);
export const uploadVideoNote = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 40 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const mimeType = String(file.mimetype || "").toLowerCase().split(";")[0].trim();
    if (!allowedVideoNoteTypes.has(mimeType)) return callback(new ApiError(400, "Unsupported video-note format"));
    callback(null, true);
  },
});

export const uploadMessageImage = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const mimeType = String(file.mimetype || "").toLowerCase().split(";")[0].trim();
    if (!allowedImageTypes.has(mimeType)) return callback(new ApiError(400, "Only JPEG, PNG, or WebP images are allowed"));
    callback(null, true);
  },
});

export const uploadGiftImage = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 8 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});

const allowedStoryTypes = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime", "video/webm"]);
export const uploadStoryMedia = multer({
  storage,
  limits: { files: 1, fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const mimeType = String(file.mimetype || "").toLowerCase().split(";")[0].trim();
    if (!allowedStoryTypes.has(mimeType)) return callback(new ApiError(400, "Unsupported Story media type"));
    callback(null, true);
  },
});
