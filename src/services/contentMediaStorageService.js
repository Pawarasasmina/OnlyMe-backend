import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";
import { MEDIA_RULES } from "../constants/contentConstants.js";
import ApiError from "../utils/ApiError.js";
import fs from "node:fs/promises";

cloudinary.config({ cloud_name: env.cloudinaryCloudName, api_key: env.cloudinaryApiKey, api_secret: env.cloudinaryApiSecret, secure: true });
const configured = () => {
  if (!env.cloudinaryCloudName || !env.cloudinaryApiKey || !env.cloudinaryApiSecret) throw new ApiError(503, "Cloudinary content storage is not configured");
};
export async function uploadContentFile({ file, creatorId, contentId, contentType }) {
  configured(); const rule = MEDIA_RULES[contentType];
  if (!rule || !file?.path) throw new ApiError(400, "A valid content media file is required");
  const folder = `onlyme/content/${creatorId}/${contentId}`;
  try {
    const asset = await cloudinary.uploader.upload(file.path, {
      resource_type: rule.resourceType,
      type: "authenticated",
      folder,
      allowed_formats: rule.formats,
      context: { purpose: "content", creator: String(creatorId), content: String(contentId) },
    });
    return { assetId: asset.public_id };
  } catch (error) {
    throw new ApiError(502, error.message || "Cloudinary media upload failed");
  } finally {
    await fs.unlink(file.path).catch(() => {});
  }
}

export function authenticatedDeliveryUrl(media) {
  if (!media?.assetId) return "";
  return cloudinary.url(media.assetId, {
    secure: true,
    sign_url: true,
    type: "authenticated",
    resource_type: media.resourceType || (media.mediaType === "IMAGE" ? "image" : "video"),
    format: media.format || undefined,
  });
}
export async function verifyContentAsset({ assetId, creatorId, contentId, contentType }) {
  configured(); const rule = MEDIA_RULES[contentType];
  if (!rule || !assetId) throw new ApiError(400, "Invalid content asset");
  const expectedPrefix = `onlyme/content/${creatorId}/${contentId}/`;
  if (!assetId.startsWith(expectedPrefix)) throw new ApiError(400, "Media does not belong to this creator and draft");
  let asset;
  try { asset = await cloudinary.api.resource(assetId, { resource_type: rule.resourceType, type: "authenticated" }); }
  catch { throw new ApiError(400, "Uploaded media could not be verified"); }
  const format = String(asset.format || "").toLowerCase();
  if (asset.resource_type !== rule.resourceType || !rule.formats.includes(format)) throw new ApiError(400, "Uploaded media type or format is not allowed");
  if (!Number.isFinite(asset.bytes) || asset.bytes > env.contentMaxFileSize) throw new ApiError(400, "Uploaded media exceeds the configured size limit");
  return { assetId: asset.public_id, resourceType: asset.resource_type, mediaType: contentType, secureUrl: asset.secure_url, format, bytes: asset.bytes, width: asset.width, height: asset.height, duration: asset.duration, uploadState: "VERIFIED" };
}

export async function verifyMediaPayload({ media = [], creatorId, contentId, contentType }) {
  if (new Set(media.map((item) => item.assetId)).size !== media.length) throw new ApiError(400, "Duplicate media assets are not allowed");
  return Promise.all(media.map(async (item, index) => ({ ...(await verifyContentAsset({ assetId: item.assetId, creatorId, contentId, contentType })), isPrimary: Boolean(item.isPrimary), sortOrder: index })));
}
