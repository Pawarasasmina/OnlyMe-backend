import { createHash, randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import FeedPost from "../models/FeedPost.js";
import WallCreationLedger from "../models/WallCreationLedger.js";
import ApiError from "../utils/ApiError.js";

export const textHash = (text) => text.trim() ? createHash("sha256").update(text.trim().toLowerCase()).digest("hex") : "";
const PURPOSES = ["Need Help", "Looking for", "Offering", "Buy & Sell", "Question", "Recommendation", "Event", "Right Now"];
export function validateWallCreation(body, files) {
  if (body.text != null && typeof body.text !== "string") throw new ApiError(400, "Note text must be a string");
  if (body.location != null && typeof body.location !== "string") throw new ApiError(400, "Place must be a string");
  const text = String(body.text || "").trim();
  if (!PURPOSES.includes(body.postType)) throw new ApiError(400, "Choose a note category");
  if (text.length > 2000) throw new ApiError(400, "Notes must be 2,000 characters or fewer");
  if (String(body.location || "").length > 120) throw new ApiError(400, "Place must be 120 characters or fewer");
  if (!text && !files.voice?.length) throw new ApiError(400, "Write something or attach a voice note");
  if ((files.media?.length || 0) > 3 || (files.voice?.length || 0) > 1) throw new ApiError(400, "Attach at most three photos and one voice note");
  if ((text.match(/https?:\/\/|www\./gi) || []).length > 1) throw new ApiError(400, "One link per post keeps Wall useful");
  if (body.rightNow != null && ![true, false, "true", "false"].includes(body.rightNow)) throw new ApiError(400, "Right now must be true or false");
  return text;
}
export async function cleanupWallFiles(files = {}) {
  await Promise.all(Object.values(files).flat().map((file) => file.path ? unlink(file.path).catch(() => {}) : null));
}
export async function wallFingerprint(req) {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(Object.entries(req.body).sort(([a], [b]) => a.localeCompare(b))));
  for (const file of [...(req.files?.media || []), ...(req.files?.voice || [])]) hash.update(await readFile(file.path));
  return hash.digest("hex");
}
export async function reserveWallCreation(author, text, key, now = new Date()) {
  const cutoff = new Date(now.getTime() - 86400000);
  // Seed once from existing publications, including archived/deleted records.
  const existing = await FeedPost.find({ author, $or: [{ publishedAt: { $gt: cutoff } }, { publishedAt: null, status: { $ne: "draft" }, createdAt: { $gt: cutoff } }] }).select("text publishedAt createdAt creationKey").lean();
  try {
    await WallCreationLedger.updateOne({ _id: author }, { $setOnInsert: { entries: existing.map((post) => ({ key: post.creationKey || String(post._id), textHash: textHash(post.text || ""), createdAt: post.publishedAt || post.createdAt })) } }, { upsert: true });
  } catch (error) { if (error.code !== 11000) throw error; }
  const fingerprint = textHash(text);
  const live = { $filter: { input: "$entries", as: "entry", cond: { $gt: ["$$entry.createdAt", cutoff] } } };
  const match = { _id: author, "entries.key": { $ne: key }, $expr: { $lt: [{ $size: live }, 5] } };
  if (fingerprint) match.entries = { $not: { $elemMatch: { textHash: fingerprint, createdAt: { $gt: cutoff } } } };
  const reserved = await WallCreationLedger.findOneAndUpdate(match, [{ $set: { entries: { $concatArrays: [live, [{ key, textHash: fingerprint, createdAt: now }]] } } }], { new: true });
  if (!reserved) {
    const ledger = await WallCreationLedger.findById(author).lean();
    if (ledger?.entries.some((entry) => entry.key === key)) throw new ApiError(409, "This note is already publishing. Check your Wall, then retry if needed.", "WALL_PUBLICATION_PENDING");
    if (fingerprint && ledger?.entries.some((entry) => entry.textHash === fingerprint && entry.createdAt > cutoff)) throw new ApiError(409, "You already posted this text in the last 24 hours.", "WALL_DUPLICATE_TEXT");
    throw new ApiError(429, "Five Wall posts in 24 hours keeps Wall useful. Try again after an earlier post leaves that window.", "WALL_DAILY_LIMIT");
  }
  return () => WallCreationLedger.updateOne({ _id: author }, { $pull: { entries: { key } } });
}
export function creationKey(req) {
  const value = req.get("Idempotency-Key") || randomUUID();
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(value)) throw new ApiError(400, "Invalid publication request key");
  return value;
}
