import fs from "node:fs/promises";
import path from "node:path";

import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";
import ApiError from "../utils/ApiError.js";

cloudinary.config({
  cloud_name: env.cloudinaryCloudName,
  api_key: env.cloudinaryApiKey,
  api_secret: env.cloudinaryApiSecret,
  secure: true,
});

function isCloudinaryConfigured() {
  return Boolean(env.cloudinaryCloudName && env.cloudinaryApiKey && env.cloudinaryApiSecret);
}

function ensureCloudinaryIsConfigured() {
  if (!isCloudinaryConfigured()) {
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

export async function storeFile(file) {
  if (!file?.path) {
    throw new ApiError(400, "A file is required");
  }

  if (!isCloudinaryConfigured()) {
    return {
      id: file.filename,
      url: `/uploads/${file.filename}`,
    };
  }

  try {
    const result = await cloudinary.uploader.upload(file.path, {
      resource_type: "image",
      folder: "onlyme/profiles",
    });

    return {
      id: result.public_id,
      url: result.secure_url,
    };
  } finally {
    await fs.unlink(file.path).catch(() => {});
  }
}

function publicIdFromCloudinaryUrl(fileUrl) {
  try {
    const url = new URL(fileUrl);
    if (url.hostname !== "res.cloudinary.com") return null;

    const uploadMarker = "/upload/";
    const uploadIndex = url.pathname.indexOf(uploadMarker);
    if (uploadIndex === -1) return null;

    const assetPath = decodeURIComponent(url.pathname.slice(uploadIndex + uploadMarker.length));
    const withoutVersion = assetPath.replace(/^v\d+\//, "");
    return withoutVersion.replace(/\.[^/.]+$/, "");
  } catch {
    return null;
  }
}

export async function deleteStoredFile(fileUrl) {
  if (!fileUrl) return;

  const publicId = publicIdFromCloudinaryUrl(fileUrl);
  if (publicId) {
    if (!isCloudinaryConfigured()) return;

    await deleteAsset(publicId);
    return;
  }

  const filename = path.basename(fileUrl);
  if (filename && filename !== "." && filename !== path.sep) {
    await fs.unlink(path.resolve("uploads", filename)).catch(() => {});
  }
}

export async function deleteAsset(publicId, resourceType = "image") {
  ensureCloudinaryIsConfigured();
  return cloudinary.uploader.destroy(publicId, {
    resource_type: resourceType,
    invalidate: true,
  });
}
