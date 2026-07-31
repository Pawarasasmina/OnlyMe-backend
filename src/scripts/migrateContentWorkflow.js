import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import Content from "../models/Content.js";
import ContentReviewHistory from "../models/ContentReviewHistory.js";
import User from "../models/User.js";

export function migrationUpdate(item, now = new Date()) {
  if (item.legacyMigration?.version === 1) return null;
  const status = item.status === "published" ? "PUBLISHED" : item.status === "draft" ? "DRAFT" : item.status;
  const contentType = item.contentType === "image" ? "IMAGE" : item.contentType;
  const accessLevel = item.accessLevel === "subscribers" ? "SUBSCRIBER_ONLY" : ["PUBLIC", "SUBSCRIBER_ONLY", "PAY_PER_VIEW"].includes(item.accessLevel) ? item.accessLevel : "SUBSCRIBER_ONLY";
  const title = [item.title, item.topic].map((value) => String(value || "").trim()).sort((a, b) => b.length - a.length)[0] || "Untitled legacy content";
  const media = item.media?.length ? item.media : (item.images || []).map((image, index) => ({ assetId: image.publicId, resourceType: "image", mediaType: "IMAGE", secureUrl: image.url, format: String(image.format || "").toLowerCase(), bytes: image.bytes, width: image.width, height: image.height, isPrimary: Boolean(image.isMain), sortOrder: index, uploadState: "VERIFIED", createdAt: item.createdAt || now }));
  return { title, topic: item.topic || item.title, status, contentType, accessLevel, media, legacyMigration: { version: 1, legacyPublished: item.status === "published", originalTitle: item.title, originalTopic: item.topic, originalStatus: item.status, originalContentType: item.contentType, originalAccessLevel: item.accessLevel, migratedAt: now } };
}

export function inspectLegacyContent(item) {
  const images = item.images || [];
  return {
    missingCreator: !item.creator,
    malformedImages: item.contentType === "image" && !images.length,
    invalidPrimary: images.length > 0 && images.filter((image) => image.isMain).length !== 1,
    unknownStatus: !["draft", "published", "DRAFT", "PENDING_REVIEW", "CHANGES_REQUESTED", "PUBLISHED", "REJECTED", "ARCHIVED"].includes(item.status),
    unknownAccess: !["subscribers", "PUBLIC", "SUBSCRIBER_ONLY", "PAY_PER_VIEW"].includes(item.accessLevel),
    partialMigration: Boolean(item.media?.length) && item.legacyMigration?.version !== 1,
    publicLeakCandidate: ["published", "PUBLISHED"].includes(item.status) && item.accessLevel !== "PUBLIC",
  };
}

async function run() {
  const apply = process.argv.includes("--apply");
  if (!apply && !process.argv.includes("--dry-run")) throw new Error("Use --dry-run or --apply explicitly");
  await connectDb(); const items = await Content.find().lean();
  const report = { mode: apply ? "apply" : "dry-run", total: items.length, statusCounts: {}, typeCounts: {}, accessCounts: {}, issues: [], migrated: 0, alreadyMigrated: 0 };
  for (const item of items) {
    report.statusCounts[item.status] = (report.statusCounts[item.status] || 0) + 1; report.typeCounts[item.contentType] = (report.typeCounts[item.contentType] || 0) + 1; report.accessCounts[item.accessLevel] = (report.accessCounts[item.accessLevel] || 0) + 1;
    const creatorExists = item.creator && await User.exists({ _id: item.creator }); const issues = inspectLegacyContent({ ...item, creator: creatorExists ? item.creator : null });
    if (Object.values(issues).some(Boolean)) report.issues.push({ id: item._id, ...issues });
    const update = migrationUpdate(item); if (!update) { report.alreadyMigrated++; continue; } report.migrated++;
    if (apply) {
      await Content.updateOne({ _id: item._id, "legacyMigration.version": { $ne: 1 } }, { $set: update });
      await ContentReviewHistory.create({ content: item._id, creator: item.creator, action: "LEGACY_MIGRATED", previousStatus: update.status, newStatus: update.status, transitionId: `content-legacy-v1-${item._id}` }).catch((error) => { if (error.code !== 11000) throw error; });
    }
  }
  if (apply) await Content.createIndexes(); console.log(JSON.stringify(report, null, 2)); await mongoose.disconnect();
}

const invokedPath = process.argv[1]?.replaceAll("\\", "/");
if (invokedPath && import.meta.url.endsWith(invokedPath.replace(/^.*\/src\//, "/src/"))) run().catch((error) => { console.error(error); process.exitCode = 1; });
