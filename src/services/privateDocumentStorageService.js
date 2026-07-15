import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createReadStream } from "node:fs";
import { env } from "../config/env.js";
import ApiError from "../utils/ApiError.js";

const SIGNATURES = [
  { mimeType: "image/jpeg", extension: ".jpg", matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mimeType: "image/png", extension: ".png", matches: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mimeType: "image/webp", extension: ".webp", matches: (b) => b.length >= 12 && b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
  { mimeType: "application/pdf", extension: ".pdf", matches: (b) => b.length >= 5 && b.subarray(0, 5).toString() === "%PDF-" },
];

const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".pdf"]);

export function assertPrivateStorageConfiguration() {
  const root = path.resolve(env.verificationStorageRoot);
  const publicUploads = path.resolve("uploads");
  if (root === publicUploads || root.startsWith(`${publicUploads}${path.sep}`)) {
    throw new Error("VERIFICATION_STORAGE_ROOT must not be inside the publicly exposed uploads directory");
  }
  return root;
}

function storageRoot() {
  return assertPrivateStorageConfiguration();
}

function safePathFor(storageKey) {
  if (!storageKey || path.isAbsolute(storageKey) || storageKey.includes("..")) {
    throw new ApiError(400, "Invalid document storage key");
  }
  const root = storageRoot();
  const resolved = path.resolve(root, storageKey);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new ApiError(400, "Invalid document storage key");
  }
  return resolved;
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
  const storageKey = path.posix.join(String(creatorId), `${crypto.randomUUID()}${detected.extension}`);
  const finalPath = safePathFor(storageKey);
  await fs.mkdir(path.dirname(finalPath), { recursive: true, mode: 0o700 });
  await fs.writeFile(finalPath, file.buffer, { flag: "wx", mode: 0o600 });
  return {
    storageKey,
    originalName: path.basename(file.originalname || "document").slice(0, 255),
    mimeType: detected.mimeType,
    size: file.size,
    checksum: crypto.createHash("sha256").update(file.buffer).digest("hex"),
    uploadedAt: new Date(),
  };
}

export async function quarantineVerificationDocument(storageKey) {
  if (!storageKey) return storageKey;
  const source = safePathFor(storageKey);
  const extension = path.extname(storageKey);
  const quarantineKey = path.posix.join(".quarantine", `${crypto.randomUUID()}${extension}`);
  const destination = safePathFor(quarantineKey);
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  try {
    await fs.rename(source, destination);
    return quarantineKey;
  } catch (error) {
    if (error.code === "ENOENT") return storageKey;
    throw error;
  }
}
export async function deleteVerificationDocument(storageKey) {
  if (!storageKey) return;
  await fs.unlink(safePathFor(storageKey)).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}

export async function sweepQuarantinedVerificationDocuments() {
  const quarantineRoot = safePathFor(".quarantine");
  let entries;
  try {
    entries = await fs.readdir(quarantineRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    await fs.unlink(path.join(quarantineRoot, entry.name));
    removed += 1;
  }
  return removed;
}
export async function openVerificationDocument(storageKey) {
  const filePath = safePathFor(storageKey);
  try {
    await fs.access(filePath);
  } catch {
    throw new ApiError(404, "Verification document file not found");
  }
  return createReadStream(filePath);
}

export function setPrivateDocumentHeaders(res, metadata, disposition = "inline") {
  const safeName = String(metadata.originalName || "document").replace(/[\r\n"\\]/g, "_");
  res.setHeader("Content-Type", metadata.mimeType);
  res.setHeader("Content-Length", metadata.size);
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `${disposition}; filename="${safeName}"`);
}


