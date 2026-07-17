import fs from "node:fs/promises";
import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";
import ApiError from "../utils/ApiError.js";

cloudinary.config({ cloud_name: env.cloudinaryCloudName, api_key: env.cloudinaryApiKey, api_secret: env.cloudinaryApiSecret, secure: true });
const configured = () => { if (!env.cloudinaryCloudName || !env.cloudinaryApiKey || !env.cloudinaryApiSecret) throw new ApiError(503, "Cloudinary publication storage is not configured"); };
const mediaRule = (type) => type === "IMAGE" ? { resourceType: "image", formats: ["jpg", "jpeg", "png", "webp"] } : ["VIDEO"].includes(type) ? { resourceType: "video", formats: ["mp4", "mov"] } : ["AUDIO", "VOICE"].includes(type) ? { resourceType: "video", formats: ["mp3", "wav", "aac", "flac"] } : null;

export async function uploadPublicationFile({ blockId, chapterId, creatorId, file, mediaType, publicationId }) {
  configured(); const rule = mediaRule(mediaType); if (!rule || !file?.path) throw new ApiError(400, "Valid publication media is required");
  const folder = `onlyme/publications/${creatorId}/${publicationId}/${chapterId}/${blockId}`;
  try { const asset = await cloudinary.uploader.upload(file.path, { resource_type: rule.resourceType, type: "authenticated", folder, allowed_formats: rule.formats, context: { purpose: "publication", creator: String(creatorId), publication: String(publicationId), chapter: String(chapterId), block: String(blockId) } }); const format=String(asset.format||"").toLowerCase();return { assetId: asset.public_id, resourceType: asset.resource_type, mediaType, format, bytes: asset.bytes, width: asset.width, height: asset.height, duration: asset.duration, secureUrl: cloudinary.url(asset.public_id,{secure:true,sign_url:true,type:"authenticated",resource_type:asset.resource_type,format:format||undefined}) }; }
  finally { await fs.unlink(file.path).catch(() => {}); }
}

export async function verifyPublicationAsset({ assetId, blockId, chapterId, creatorId, mediaType, publicationId }) {
  configured(); const rule = mediaRule(mediaType); if (!rule || !assetId) throw new ApiError(400, "Invalid publication asset");
  const prefix = `onlyme/publications/${creatorId}/${publicationId}/${chapterId}/${blockId}/`; if (!assetId.startsWith(prefix)) throw new ApiError(400, "Media does not belong to this publication block");
  let asset; try { asset = await cloudinary.api.resource(assetId, { resource_type: rule.resourceType, type: "authenticated" }); } catch { throw new ApiError(400, "Publication media could not be verified"); }
  const format = String(asset.format || "").toLowerCase(); if (asset.resource_type !== rule.resourceType || !rule.formats.includes(format) || asset.bytes > env.contentMaxFileSize) throw new ApiError(400, "Publication media type, format, or size is invalid");
  return { assetId: asset.public_id, resourceType: asset.resource_type, mediaType, secureUrl: asset.secure_url, format, bytes: asset.bytes, width: asset.width, height: asset.height, duration: asset.duration };
}

export function publicationDeliveryUrl(media) { if (!media?.assetId) return ""; return cloudinary.url(media.assetId, { secure: true, sign_url: true, type: "authenticated", resource_type: media.resourceType || (media.mediaType === "IMAGE" ? "image" : "video"), format: media.format || undefined }); }
