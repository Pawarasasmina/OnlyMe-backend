import fs from "node:fs/promises";
import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";
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

export async function deleteFeedPostImage(assetId) {
  if (!assetId) return;
  ensureConfigured();
  await cloudinary.uploader.destroy(assetId, { resource_type: "image", invalidate: true });
}

export async function deleteFeedPostImages(media = []) {
  await Promise.all(media.map((item) => deleteFeedPostImage(item.assetId).catch(() => {})));
}
