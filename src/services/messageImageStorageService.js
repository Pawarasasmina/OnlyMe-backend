import { v2 as cloudinary } from "cloudinary";
import ApiError from "../utils/ApiError.js";
import { env } from "../config/env.js";

cloudinary.config({ cloud_name: env.cloudinaryCloudName, api_key: env.cloudinaryApiKey, api_secret: env.cloudinaryApiSecret, secure: true });

function configured() {
  if (!env.cloudinaryCloudName || !env.cloudinaryApiKey || !env.cloudinaryApiSecret) {
    throw new ApiError(503, "Message-image storage is not configured");
  }
}

export async function uploadMessageImage({ buffer, senderId }) {
  configured();
  if (!buffer?.length) throw new ApiError(400, "An image is required");
  const asset = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      resource_type: "image",
      type: "authenticated",
      folder: `onlyme/messages/images/${senderId}`,
      allowed_formats: ["jpg", "jpeg", "png", "webp"],
      context: { purpose: "private_message_image", sender: String(senderId) },
    }, (error, result) => error ? reject(error) : resolve(result));
    stream.end(buffer);
  }).catch((error) => {
    throw new ApiError(502, error.message || "Message-image upload failed");
  });
  return {
    assetId: asset.public_id,
    resourceType: "image",
    format: asset.format,
    bytes: asset.bytes,
    width: asset.width,
    height: asset.height,
  };
}

export function messageImageUrl(image) {
  if (!image?.assetId) return "";
  return cloudinary.url(image.assetId, {
    secure: true,
    sign_url: true,
    type: "authenticated",
    resource_type: "image",
    format: image.format || undefined,
  });
}
