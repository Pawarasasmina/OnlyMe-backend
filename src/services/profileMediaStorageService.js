import fs from "node:fs/promises";
import path from "node:path";
import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";
import {
  PROFILE_MEDIA_IMAGE_EXTENSIONS,
  PROFILE_MEDIA_IMAGE_MIME_TYPES,
  PROFILE_MEDIA_MAX_IMAGE_SIZE_BYTES,
  PROFILE_MEDIA_MAX_VIDEO_DURATION_SECONDS,
  PROFILE_MEDIA_MAX_VIDEO_SIZE_BYTES,
  PROFILE_MEDIA_VIDEO_EXTENSIONS,
  PROFILE_MEDIA_VIDEO_MIME_TYPES,
} from "../constants/profileMediaConstants.js";
import ApiError from "../utils/ApiError.js";

cloudinary.config({ cloud_name: env.cloudinaryCloudName, api_key: env.cloudinaryApiKey, api_secret: env.cloudinaryApiSecret, secure: true });

const imageTypes = new Set(PROFILE_MEDIA_IMAGE_MIME_TYPES);
const videoTypes = new Set(PROFILE_MEDIA_VIDEO_MIME_TYPES);
const imageExtensions = new Set(PROFILE_MEDIA_IMAGE_EXTENSIONS);
const videoExtensions = new Set(PROFILE_MEDIA_VIDEO_EXTENSIONS);

function ensureConfigured() {
  if (!env.cloudinaryCloudName || !env.cloudinaryApiKey || !env.cloudinaryApiSecret) {
    throw new ApiError(503, "Cloudinary profile media storage is not configured");
  }
}

export function profileMediaTypeForFile(file = {}) {
  const mimeType = String(file.mimetype || "").toLowerCase().split(";")[0].trim();
  if (imageTypes.has(mimeType)) return "image";
  if (videoTypes.has(mimeType)) return "video";
  return "";
}

export function validateProfileMediaFile(file = {}) {
  const type = profileMediaTypeForFile(file);
  if (!type) throw new ApiError(400, "Profile Media supports JPEG, PNG, WebP, MP4, MOV, or WebM files");

  const extension = path.extname(file.originalname || "").toLowerCase();
  const allowedExtensions = type === "image" ? imageExtensions : videoExtensions;
  if (!allowedExtensions.has(extension)) throw new ApiError(400, "Profile Media file extension is not supported");

  const maxSize = type === "image" ? PROFILE_MEDIA_MAX_IMAGE_SIZE_BYTES : PROFILE_MEDIA_MAX_VIDEO_SIZE_BYTES;
  if (Number(file.size || 0) > maxSize) {
    const limit = Math.round(maxSize / 1024 / 1024);
    throw new ApiError(400, `${type === "image" ? "Photos" : "Videos"} must be ${limit} MB or smaller`);
  }

  return { mimeType: String(file.mimetype || "").toLowerCase(), type };
}

export function profileMediaVideoThumbnailUrl(assetId) {
  if (!assetId) return "";
  return cloudinary.url(assetId, {
    crop: "fill",
    gravity: "auto",
    height: 480,
    quality: "auto",
    resource_type: "video",
    secure: true,
    width: 384,
    format: "jpg",
  });
}

export async function uploadProfileMediaFile({ file, userId }) {
  const { mimeType, type } = validateProfileMediaFile(file);
  ensureConfigured();

  const resourceType = type === "video" ? "video" : "image";
  try {
    const asset = await cloudinary.uploader.upload(file.path, {
      resource_type: resourceType,
      folder: `onlyme/profile-media/${userId}`,
      allowed_formats: type === "video" ? ["mp4", "mov", "webm"] : ["jpg", "jpeg", "png", "webp"],
      context: { purpose: "profile_media", user: String(userId), source: "direct" },
    });

    const duration = Number(asset.duration) || 0;
    if (type === "video" && (!Number.isFinite(duration) || duration <= 0 || duration > PROFILE_MEDIA_MAX_VIDEO_DURATION_SECONDS)) {
      await cloudinary.uploader.destroy(asset.public_id, { resource_type: "video", invalidate: true }).catch(() => {});
      throw new ApiError(400, `Profile Media videos must be ${PROFILE_MEDIA_MAX_VIDEO_DURATION_SECONDS} seconds or shorter`);
    }

    return {
      assetId: asset.public_id,
      duration,
      format: String(asset.format || "").toLowerCase(),
      height: Number(asset.height) || 0,
      mimeType,
      resourceType,
      size: Number(asset.bytes || file.size || 0),
      thumbnailUrl: type === "video" ? profileMediaVideoThumbnailUrl(asset.public_id) : asset.secure_url,
      type,
      url: asset.secure_url,
      width: Number(asset.width) || 0,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, error.message || "Profile Media upload failed");
  } finally {
    if (file?.path) await fs.unlink(file.path).catch(() => {});
  }
}

export async function deleteProfileMediaFile(item = {}) {
  if (!item?.assetId) return;
  ensureConfigured();
  await cloudinary.uploader.destroy(item.assetId, {
    invalidate: true,
    resource_type: item.resourceType || item.type || "image",
  });
}
