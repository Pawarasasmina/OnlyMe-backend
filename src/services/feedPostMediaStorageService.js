import fs from "node:fs/promises";
import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";
import { POST_MAX_IMAGE_SIZE } from "../constants/postConstants.js";
import ApiError from "../utils/ApiError.js";

cloudinary.config({
  cloud_name: env.cloudinaryCloudName,
  api_key: env.cloudinaryApiKey,
  api_secret: env.cloudinaryApiSecret,
  secure: true,
});

function ensureConfigured() {
  if (!env.cloudinaryCloudName || !env.cloudinaryApiKey || !env.cloudinaryApiSecret) {
    throw new ApiError(503, "Cloudinary post media storage is not configured");
  }
}

export async function uploadFeedPostImage({ file, postId, userId, sortOrder = 0 }) {
  ensureConfigured();

  if (!file?.path) {
    throw new ApiError(400, "A valid image file is required");
  }

  if (file.size > POST_MAX_IMAGE_SIZE) {
    await fs.unlink(file.path).catch(() => {});
    throw new ApiError(400, "Images must be 15 MB or smaller");
  }

  try {
    const result = await cloudinary.uploader.upload(file.path, {
      resource_type: "image",
      folder: `onlyme/feed-posts/${userId}/${postId}`,
      allowed_formats: ["jpg", "jpeg", "png", "webp"],
      context: { purpose: "feed_post", post: String(postId), user: String(userId) },
    });

    return {
      assetId: result.public_id,
      url: result.secure_url,
      type: "image",
      format: String(result.format || "").toLowerCase(),
      bytes: result.bytes,
      width: result.width,
      height: result.height,
      sortOrder,
      originalName: file.originalname || "",
    };
  } catch (error) {
    throw new ApiError(502, error.message || "Cloudinary post media upload failed");
  } finally {
    await fs.unlink(file.path).catch(() => {});
  }
}

export async function uploadFeedPostVoice({
  file,
  postId,
  sortOrder = 0,
  transcript = "",
  transcriptLanguage = "",
  translations = [],
  userId,
  waveform = [],
}) {
  ensureConfigured();

  if (!file?.path) {
    throw new ApiError(400, "A valid voice recording is required");
  }

  if (file.size > env.maxVoiceNoteSizeBytes) {
    await fs.unlink(file.path).catch(() => {});
    throw new ApiError(400, `Voice notes must be ${Math.round(env.maxVoiceNoteSizeBytes / 1024 / 1024)} MB or smaller`);
  }

  try {
    const result = await cloudinary.uploader.upload(file.path, {
      resource_type: "video",
      folder: `onlyme/feed-posts/${userId}/${postId}/voice`,
      allowed_formats: ["webm", "ogg", "mp4", "mp3", "wav"],
      context: { purpose: "feed_post_voice", post: String(postId), user: String(userId) },
    });

    const duration = Number(result.duration);
    if (!Number.isFinite(duration) || duration < 1 || duration > env.maxVoiceNoteDurationSeconds) {
      await cloudinary.uploader.destroy(result.public_id, { resource_type: "video", invalidate: true }).catch(() => {});
      throw new ApiError(400, `Voice notes must be between 1 second and ${Math.round(env.maxVoiceNoteDurationSeconds / 60)} minutes`);
    }

    return {
      assetId: result.public_id,
      url: result.secure_url,
      type: "audio",
      format: String(result.format || "").toLowerCase(),
      bytes: result.bytes,
      duration,
      mimeType: file.mimetype || "",
      transcript,
      transcriptLanguage,
      translations,
      waveform,
      sortOrder,
      originalName: file.originalname || "",
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, error.message || "Cloudinary voice-note upload failed");
  } finally {
    await fs.unlink(file.path).catch(() => {});
  }
}

export async function deleteFeedPostImage(assetId) {
  if (!assetId) return;
  ensureConfigured();
  await cloudinary.uploader.destroy(assetId, { resource_type: "image", invalidate: true });
}

export async function deleteFeedPostMedia(media = []) {
  ensureConfigured();
  await Promise.all(media.map((item) => {
    if (!item?.assetId) return Promise.resolve();
    const resourceType = item.type === "audio" ? "video" : "image";
    return cloudinary.uploader.destroy(item.assetId, { resource_type: resourceType, invalidate: true }).catch(() => {});
  }));
}

export const deleteFeedPostImages = deleteFeedPostMedia;
