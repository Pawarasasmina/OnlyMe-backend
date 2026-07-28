import { v2 as cloudinary } from "cloudinary";
import ApiError from "../utils/ApiError.js";
import { env } from "../config/env.js";

cloudinary.config({ cloud_name: env.cloudinaryCloudName, api_key: env.cloudinaryApiKey, api_secret: env.cloudinaryApiSecret, secure: true });

function configured() {
  if (!env.cloudinaryCloudName || !env.cloudinaryApiKey || !env.cloudinaryApiSecret) {
    throw new ApiError(503, "Video-note storage is not configured");
  }
}

export async function uploadMessageVideo({ buffer, senderId }) {
  configured();
  if (!buffer?.length) throw new ApiError(400, "A video note is required");
  const asset = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      resource_type: "video",
      type: "authenticated",
      folder: `onlyme/messages/video/${senderId}`,
      allowed_formats: ["webm", "mp4", "mov"],
      context: { purpose: "private_video_note", sender: String(senderId) },
    }, (error, result) => error ? reject(error) : resolve(result));
    stream.end(buffer);
  }).catch((error) => {
    throw new ApiError(502, error.message || "Video-note upload failed");
  });
  if (!Number.isFinite(asset.duration) || asset.duration < 1 || asset.duration > 61) {
    await cloudinary.uploader.destroy(asset.public_id, { resource_type: "video", type: "authenticated" }).catch(() => {});
    throw new ApiError(400, "Video notes must be between 1 and 60 seconds");
  }
  return {
    assetId: asset.public_id,
    resourceType: "video",
    format: asset.format,
    bytes: asset.bytes,
    duration: asset.duration,
    width: asset.width,
    height: asset.height,
  };
}

export function messageVideoUrl(video) {
  if (!video?.assetId) return "";
  return cloudinary.url(video.assetId, {
    secure: true,
    sign_url: true,
    type: "authenticated",
    resource_type: "video",
    format: video.format || undefined,
  });
}
