import crypto from "node:crypto";
import User from "../models/User.js";
import { deleteAsset } from "./storageService.js";

function ownedAssets(value, ownerId, assets = new Map()) {
  if (!value || typeof value !== "object") return assets;
  // Shared story/Seen references may contain another person's assets. Never delete those.
  if (typeof value.assetId === "string" && value.assetId.split("/").includes(String(ownerId))) {
    const delivery = value.deliveryType || (value.assetId.startsWith("onlyme/publications/") ? "authenticated" : "upload");
    const resource = value.resourceType || (value.mediaType === "IMAGE" ? "image" : "video");
    assets.set(`${delivery}:${resource}:${value.assetId}`, { id: value.assetId, resource, delivery });
  }
  for (const child of Object.values(value)) if (child && typeof child === "object" && !child._bsontype && !(child instanceof Date)) ownedAssets(child, ownerId, assets);
  return assets;
}

// Retain financial/audit references to a tombstone, not a login-capable account.
// Repeated passes finish partially completed cleanup after an interrupted worker.
export async function processDueAccountDeletions(now = new Date()) {
  const users = await User.find({ status: { $in: ["pending_deletion", "deleted"] }, deletionScheduledAt: { $lte: now }, deletionCompletedAt: null }).limit(25).lean();
  let processed = 0;
  for (const user of users) {
    const claimed = await User.findOneAndUpdate({ _id: user._id, status: { $in: ["pending_deletion", "deleted"] }, deletionScheduledAt: { $lte: now } }, { $set: { status: "deleted" } }, { new: true });
    if (!claimed) continue;
    const db = User.db;
    const publications = await db.collection("publications").find({ creator: user._id }).toArray();
    const chapters = await db.collection("chapters").find({ publication: { $in: publications.map(row => row._id) } }).toArray();
    const assets = ownedAssets([...publications, ...chapters], user._id);
    for (const [collection, field] of [["stories", "creator"], ["storyarchives", "creator"], ["profilemedias", "user"], ["feedposts", "author"]]) {
      ownedAssets(await db.collection(collection).find({ [field]: user._id }).toArray(), user._id, assets);
    }
    // Keep references until storage cleanup succeeds so a failed request can be retried.
    for (const asset of assets.values()) await deleteAsset(asset.id, asset.resource, asset.delivery);
    await db.collection("chapters").deleteMany({ publication: { $in: publications.map(row => row._id) } });
    // Leave receipts, ledgers, moderation decisions and other people's messages intact.
    for (const [collection, field] of [["publications", "creator"], ["contents", "creator"], ["stories", "creator"], ["storyarchives", "creator"], ["storyhighlights", "creator"], ["wallposts", "creator"], ["feedposts", "author"], ["profilemedias", "user"], ["publicationseries", "creator"], ["creatorprofiles", "user"], ["fanprofiles", "user"], ["payoutbankapplications", "user"]]) {
      await db.collection(collection).deleteMany({ [field]: user._id });
    }
    await User.updateOne({ _id: user._id, status: "deleted" }, { $set: { name: "Deleted account", username: `deleted_${user._id}`, email: `deleted_${user._id}@deleted.invalid`, password: crypto.randomBytes(48).toString("hex"), avatar: "", isVerified: false, deletionCompletedAt: now }, $unset: { activeStatus: 1, onboarding: 1, resetPasswordToken: 1, resetPasswordExpires: 1 } });
    processed++;
  }
  return { processed };
}
