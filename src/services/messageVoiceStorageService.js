import { v2 as cloudinary } from "cloudinary";
import ApiError from "../utils/ApiError.js";
import { env } from "../config/env.js";

cloudinary.config({ cloud_name: env.cloudinaryCloudName, api_key: env.cloudinaryApiKey, api_secret: env.cloudinaryApiSecret, secure: true });

function configured() {
  if (!env.cloudinaryCloudName || !env.cloudinaryApiKey || !env.cloudinaryApiSecret) {
    throw new ApiError(503, "Voice-message storage is not configured");
  }
}

export async function uploadMessageVoice({ buffer, senderId, folder = "", maxDurationSeconds = 300, purpose = "private_voice_message" }) {
  configured();
  if (!buffer?.length) throw new ApiError(400, "A voice recording is required");
  const asset = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      resource_type: "video",
      type: "authenticated",
      folder: folder || `onlyme/messages/voice/${senderId}`,
      allowed_formats: ["webm", "ogg", "mp4", "mp3", "wav"],
      context: { purpose, sender: String(senderId) },
    }, (error, result) => error ? reject(error) : resolve(result));
    stream.end(buffer);
  }).catch((error) => {
    throw new ApiError(502, error.message || "Voice-message upload failed");
  });
  if (!Number.isFinite(asset.duration) || asset.duration < 1 || asset.duration > maxDurationSeconds) {
    await cloudinary.uploader.destroy(asset.public_id, { resource_type: "video", type: "authenticated" }).catch(() => {});
    throw new ApiError(400, `Voice messages must be between 1 second and ${maxDurationSeconds >= 60 ? `${Math.floor(maxDurationSeconds / 60)} minutes` : `${maxDurationSeconds} seconds`}`);
  }
  return { assetId: asset.public_id, resourceType: "video", format: asset.format, bytes: asset.bytes, duration: asset.duration };
}

export function messageVoiceUrl(audio) {
  if (!audio?.assetId) return "";
  return cloudinary.url(audio.assetId, {
    secure: true,
    sign_url: true,
    type: "authenticated",
    resource_type: "video",
    format: audio.format || undefined,
  });
}
