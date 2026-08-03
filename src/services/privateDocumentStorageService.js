import crypto from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";
import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";
import ApiError from "../utils/ApiError.js";

cloudinary.config({
  cloud_name: env.cloudinaryCloudName,
  api_key: env.cloudinaryApiKey,
  api_secret: env.cloudinaryApiSecret,
  secure: true,
});

const SIGNATURES = [
  { mimeType: "image/jpeg", extension: ".jpg", matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mimeType: "image/png", extension: ".png", matches: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mimeType: "image/webp", extension: ".webp", matches: (b) => b.length >= 12 && b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
  { mimeType: "application/pdf", extension: ".pdf", matches: (b) => b.length >= 5 && b.subarray(0, 5).toString() === "%PDF-" },
];

const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".pdf"]);
const STORAGE_KEY_PREFIX = "cloudinary:v1:";

export function assertPrivateStorageConfiguration() {
  if (env.nodeEnv === "production" && (!env.cloudinaryCloudName || !env.cloudinaryApiKey || !env.cloudinaryApiSecret)) {
    throw new Error("Cloudinary must be configured for private verification document storage");
  }
  return true;
}

function ensureCloudinaryIsConfigured() {
  if (!env.cloudinaryCloudName || !env.cloudinaryApiKey || !env.cloudinaryApiSecret) {
    throw new ApiError(503, "Private verification document storage is not configured");
  }
}

function encodeStorageKey(asset) {
  return `${STORAGE_KEY_PREFIX}${Buffer.from(JSON.stringify({
    publicId: asset.public_id,
    resourceType: asset.resource_type,
    format: asset.format,
  })).toString("base64url")}`;
}

function decodeStorageKey(storageKey) {
  if (!storageKey?.startsWith(STORAGE_KEY_PREFIX)) throw new ApiError(400, "Invalid document storage key");
  try {
    const value = JSON.parse(Buffer.from(storageKey.slice(STORAGE_KEY_PREFIX.length), "base64url").toString("utf8"));
    if (!value.publicId || !["image", "raw"].includes(value.resourceType) || !value.format) throw new Error("Invalid key");
    return value;
  } catch {
    throw new ApiError(400, "Invalid document storage key");
  }
}

export function inspectVerificationFile(file) {
  if (!file?.buffer?.length) throw new ApiError(400, "Verification document is required");
  if (file.size > env.verificationMaxFileSize) throw new ApiError(400, "Verification document is too large");
  const originalExtension = path.extname(file.originalname || "").toLowerCase();
  if (!allowedExtensions.has(originalExtension)) throw new ApiError(400, "Only JPEG, PNG, WebP, or PDF files are allowed");
  const detected = SIGNATURES.find((signature) => signature.matches(file.buffer));
  if (!detected) throw new ApiError(400, "The uploaded file content is not a supported document type");
  if (detected.mimeType !== file.mimetype) throw new ApiError(400, "The uploaded file type does not match its content");
  if (detected.mimeType === "image/jpeg" && ![".jpg", ".jpeg"].includes(originalExtension)) {
    throw new ApiError(400, "The uploaded file extension does not match its content");
  }
  if (detected.mimeType !== "image/jpeg" && originalExtension !== detected.extension) {
    throw new ApiError(400, "The uploaded file extension does not match its content");
  }
  return detected;
}

export async function storeVerificationDocument(file, creatorId) {
  const detected = inspectVerificationFile(file);
  ensureCloudinaryIsConfigured();
  const resourceType = detected.mimeType === "application/pdf" ? "raw" : "image";
  const publicId = `onlyme/private/creator-verifications/${creatorId}/${crypto.randomUUID()}`;
  let asset;
  try {
    asset = await new Promise((resolve, reject) => {
      const upload = cloudinary.uploader.upload_stream({
        public_id: publicId,
        resource_type: resourceType,
        type: "authenticated",
        format: detected.extension.slice(1),
        context: { purpose: "creator_verification", creator: String(creatorId) },
      }, (error, result) => error ? reject(error) : resolve(result));
      upload.end(file.buffer);
    });
  } catch (error) {
    throw new ApiError(502, error.message || "Verification document upload failed");
  }
  return {
    storageKey: encodeStorageKey({ ...asset, format: asset.format || detected.extension.slice(1) }),
    originalName: path.basename(file.originalname || "document").slice(0, 255),
    mimeType: detected.mimeType,
    size: file.size,
    checksum: crypto.createHash("sha256").update(file.buffer).digest("hex"),
    uploadedAt: new Date(),
  };
}

export async function quarantineVerificationDocument(storageKey) {
  // Authenticated Cloudinary assets have no public delivery URL. The durable
  // cleanup job is the quarantine boundary until deletion succeeds.
  if (storageKey) decodeStorageKey(storageKey);
  return storageKey;
}

export async function deleteVerificationDocument(storageKey) {
  if (!storageKey) return;
  ensureCloudinaryIsConfigured();
  const asset = decodeStorageKey(storageKey);
  const result = await cloudinary.uploader.destroy(asset.publicId, {
    resource_type: asset.resourceType,
    type: "authenticated",
    invalidate: true,
  });
  if (!["ok", "not found"].includes(result.result)) throw new Error("Cloudinary could not delete the verification document");
}

export async function sweepQuarantinedVerificationDocuments() {
  return 0;
}

export async function openVerificationDocument(storageKey) {
  ensureCloudinaryIsConfigured();
  const asset = decodeStorageKey(storageKey);
  const url = cloudinary.utils.private_download_url(asset.publicId, asset.format, {
    resource_type: asset.resourceType,
    type: "authenticated",
    expires_at: Math.floor(Date.now() / 1000) + 60,
  });
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new ApiError(502, error.message || "Verification document could not be retrieved");
  }
  if (response.status === 404) throw new ApiError(404, "Verification document file not found");
  if (!response.ok || !response.body) throw new ApiError(502, "Verification document could not be retrieved");
  return Readable.fromWeb(response.body);
}

export function setPrivateDocumentHeaders(res, metadata, disposition = "inline") {
  const safeName = String(metadata.originalName || "document").replace(/[\r\n"\\]/g, "_");
  res.setHeader("Content-Type", metadata.mimeType);
  res.setHeader("Content-Length", metadata.size);
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `${disposition}; filename="${safeName}"`);
}
