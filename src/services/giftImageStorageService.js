import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";
import ApiError from "../utils/ApiError.js";

cloudinary.config({ cloud_name: env.cloudinaryCloudName, api_key: env.cloudinaryApiKey, api_secret: env.cloudinaryApiSecret, secure: true });

function ensureConfigured() {
  if (!env.cloudinaryCloudName || !env.cloudinaryApiKey || !env.cloudinaryApiSecret) throw new ApiError(503, "Cloudinary gift storage is not configured");
}

export async function uploadGiftImage(file, adminId) {
  ensureConfigured();
  if (!file?.buffer?.length) throw new ApiError(400, "A gift image is required");
  const asset = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      resource_type: "image", folder: "onlyme/gifts", allowed_formats: ["png", "webp", "jpg", "jpeg"],
      transformation: [{ width: 1024, height: 1024, crop: "limit" }, { quality: "auto:best", fetch_format: "auto" }],
      context: { purpose: "dream_gift", admin: String(adminId) },
    }, (error, result) => error ? reject(error) : resolve(result));
    stream.end(file.buffer);
  }).catch((error) => { throw new ApiError(502, error.message || "Gift image upload failed"); });
  return { assetId: asset.public_id, url: asset.secure_url, format: asset.format, bytes: asset.bytes, width: asset.width, height: asset.height };
}

export async function deleteGiftImage(assetId) {
  if (!assetId) return;
  ensureConfigured();
  await cloudinary.uploader.destroy(assetId, { resource_type: "image", invalidate: true });
}
