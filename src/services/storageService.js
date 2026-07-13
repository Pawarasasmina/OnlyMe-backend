import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";
import ApiError from "../utils/ApiError.js";

cloudinary.config({
  cloud_name: env.cloudinaryCloudName,
  api_key: env.cloudinaryApiKey,
  api_secret: env.cloudinaryApiSecret,
  secure: true,
});

function ensureCloudinaryIsConfigured() {
  if (!env.cloudinaryCloudName || !env.cloudinaryApiKey || !env.cloudinaryApiSecret) {
    throw new ApiError(503, "Cloudinary is not configured on the server");
  }
}

export function createUploadSignature(userId) {
  ensureCloudinaryIsConfigured();

  const timestamp = Math.round(Date.now() / 1000);
  const folder = `onlyme/${userId}`;
  const signature = cloudinary.utils.api_sign_request(
    { folder, timestamp },
    env.cloudinaryApiSecret
  );

  return {
    signature,
    timestamp,
    folder,
    cloudName: env.cloudinaryCloudName,
    apiKey: env.cloudinaryApiKey,
    uploadUrl: `https://api.cloudinary.com/v1_1/${env.cloudinaryCloudName}/image/upload`,
  };
}

export async function deleteAsset(publicId, resourceType = "image") {
  ensureCloudinaryIsConfigured();
  return cloudinary.uploader.destroy(publicId, {
    resource_type: resourceType,
    invalidate: true,
  });
}
