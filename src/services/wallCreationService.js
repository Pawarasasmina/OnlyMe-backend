import { assertWallLocationSafety } from "./wallMeetupSafetyService.js";
import { assertAccountAge } from "../utils/accountAge.js";
import { createHash, randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import FeedPost from "../models/FeedPost.js";
import WallCreationLedger from "../models/WallCreationLedger.js";
import WallPublicationLog from "../models/WallPublicationLog.js";
import MessageReport from "../models/MessageReport.js";
import ApiError from "../utils/ApiError.js";
import { readWallPrice } from "./wallPriceService.js";
import { normalizeWallText, hasWallContacts, wallLinks, wallAccountPolicy, wallCopySimilarity, WALL_DAY_MS } from "./wallPublishingPolicy.js";

export const textHash = (text) => normalizeWallText(text) ? createHash("sha256").update(normalizeWallText(text)).digest("hex") : "";
const PURPOSES = ["Company","Need Help", "Looking for", "Offering", "Buy & Sell", "Question", "Recommendation", "Event", "Right Now"];
export function validateWallCreation(body, files = {}, user = null) {
  assertWallLocationSafety(body);
  if (user) assertAccountAge(user);
  readWallPrice(body.price, body.postType, body.location, body.countryCode);
  if (body.text != null && typeof body.text !== "string") throw new ApiError(400, "Note text must be a string");
  if (body.location != null && typeof body.location !== "string") throw new ApiError(400, "Place must be a string");
  const text = String(body.text || "").trim();
  if (!PURPOSES.includes(body.postType)) throw new ApiError(400, "Choose a note category");
  if (text.length > 2000) throw new ApiError(400, "Notes must be 2,000 characters or fewer");
  if (String(body.location || "").length > 120) throw new ApiError(400, "Place must be 120 characters or fewer");
  if (!text && !files.voice?.length) throw new ApiError(400, "Write something or attach a voice note");
  if ((files.media?.length || 0) > 3 || (files.voice?.length || 0) > 1) throw new ApiError(400, "Attach at most three photos and one voice note");
  validateWallPublishingText([text, body.voiceTranscript || ""].filter(Boolean).join(" "), user);
  if (body.rightNow != null && ![true, false, "true", "false"].includes(body.rightNow)) throw new ApiError(400, "Right now must be true or false");
  return text;
}
export function validateWallPublishingText(text, user = null) {
  assertWallLocationSafety({ text });
  if (hasWallContacts(text)) throw new ApiError(400, "Keep numbers and messengers out \u2014 people can message you right from the note", "WALL_CONTACT_DETAILS");
  const links = wallLinks(text);
  if (user && wallAccountPolicy(user).isNew && links.length) throw new ApiError(400, "Links open after your first week", "WALL_NEW_ACCOUNT_LINK");
  if (links.length > 1) throw new ApiError(400, "One link per post keeps Wall useful", "WALL_LINK_LIMIT");
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
async function ensureWallLedger(author, cutoff) {
  // Seed once from existing publications, including archived/deleted records.
  const existing = await FeedPost.find({ author, $or: [{ publishedAt: { $gt: cutoff } }, { publishedAt: null, status: { $ne: "draft" }, createdAt: { $gt: cutoff } }] }).select("text postType publishedAt createdAt creationKey media.transcript").lean();
  if (existing.length) try { await WallPublicationLog.bulkWrite(existing.map(post => ({ updateOne: { filter: { author, key: post.creationKey || String(post._id) }, update: { $setOnInsert: { author, key: post.creationKey || String(post._id), postId: post._id, postType: post.postType || "", textHash: textHash(post.text || ""), normalizedText: normalizeWallText(post.text || ""), publishedAt: post.publishedAt || post.createdAt } }, upsert: true } })), { ordered: false }); }
  catch (error) { if (error.code !== 11000 && !error.writeErrors?.every(entry => entry.code === 11000)) throw error; }
  const publications = await WallPublicationLog.find({ author, publishedAt: { $gt: cutoff } }).lean();
  try {
    await WallCreationLedger.updateOne({ _id: author }, { $setOnInsert: { entries: publications.map(post => ({ key: post.key, textHash: post.textHash, textHashes: [...new Set([post.textHash, ...(post.textHistory || []).map(textHash)].filter(Boolean))], postType: post.postType || "", createdAt: post.publishedAt })) } }, { upsert: true });
  } catch (error) { if (error.code !== 11000) throw error; }
}
export async function reserveWallCreation(author, text, key, now = new Date(), options = {}) {
  const cutoff = new Date(now.getTime() - WALL_DAY_MS);
  const policy = wallAccountPolicy(options.user || {}, now);
  const postType = options.postType || "";
  await ensureWallLedger(author, cutoff);
  const fingerprint = textHash(text);
  const normalized = normalizeWallText(text);
  if (fingerprint && await WallPublicationLog.exists({ author, key: { $ne: key }, publishedAt: { $gt: cutoff }, $or: [{ textHash: fingerprint }, { textHistory: normalized }] })) throw new ApiError(409, "You already posted this today", "WALL_DUPLICATE_TEXT");
  if (policy.isBusiness && postType === "Offering" && await WallPublicationLog.exists({ author, key: { $ne: key }, postType: "Offering", publishedAt: { $gt: cutoff } })) throw new ApiError(429, "Business accounts: one offer a day", "WALL_BUSINESS_OFFERING_LIMIT");
  const live = { $filter: { input: "$entries", as: "entry", cond: { $gt: ["$$entry.createdAt", cutoff] } } };
  const conditions = [{ $lt: [{ $size: live }, policy.dailyLimit] }];
  if (policy.isBusiness && postType === "Offering") conditions.push({ $eq: [{ $size: { $filter: { input: live, as: "offering", cond: { $eq: ["$$offering.postType", "Offering"] } } } }, 0] });
  const match = { _id: author, "entries.key": { $ne: key }, $expr: { $and: conditions } };
  if (fingerprint) match.entries = { $not: { $elemMatch: { $or: [{ textHash: fingerprint }, { textHashes: fingerprint }], createdAt: { $gt: cutoff } } } };
  const reserved = await WallCreationLedger.findOneAndUpdate(match, [{ $set: { entries: { $concatArrays: [live, [{ key, textHash: fingerprint, textHashes: fingerprint ? [fingerprint] : [], postType, createdAt: now }]] } } }], { new: true });
  if (!reserved) {
    const ledger = await WallCreationLedger.findById(author).lean();
    if (ledger?.entries.some((entry) => entry.key === key)) throw new ApiError(409, "This note is already publishing. Check your Wall, then retry if needed.", "WALL_PUBLICATION_PENDING");
    if (fingerprint && ledger?.entries.some((entry) => (entry.textHash === fingerprint || entry.textHashes?.includes(fingerprint)) && entry.createdAt > cutoff)) throw new ApiError(409, "You already posted this today", "WALL_DUPLICATE_TEXT");
    if (policy.isBusiness && postType === "Offering" && ledger?.entries.some(entry => entry.postType === "Offering" && entry.createdAt > cutoff)) throw new ApiError(429, "Business accounts: one offer a day", "WALL_BUSINESS_OFFERING_LIMIT");
    throw new ApiError(429, policy.isNew ? "New here: 2 Wall notes a day for your first week" : "Five Wall posts in 24 hours keeps Wall useful. Try again after an earlier post leaves that window.", "WALL_DAILY_LIMIT");
  }
  const release = async () => { await WallCreationLedger.updateOne({ _id: author }, { $pull: { entries: { key } } }); await WallPublicationLog.deleteOne({ author, key }); };
  try { await WallPublicationLog.updateOne({ author, key }, { $setOnInsert: { author, key, postId: options.postId || null, postType, textHash: fingerprint, normalizedText: normalized, publishedAt: now } }, { upsert: true }); }
  catch (error) { await release(); throw error; }
  return release;
}

export async function findRecentWallCopy(author, text, now = new Date(), excludePostId = null) {
  const normalized = normalizeWallText(text);
  if (!normalized) return null;
  const cutoff = new Date(now.getTime() - WALL_DAY_MS);
  const exact = await WallPublicationLog.findOne({ author: { $ne: author }, textHash: textHash(normalized), publishedAt: { $gt: cutoff } }).select("author key normalizedText").lean();
  if (exact) return { matchedAuthorId: exact.author, matchedKey: exact.key, matchedText: exact.normalizedText, similarity: 1, exact: true };
  const recent = await WallPublicationLog.find({ author: { $ne: author }, publishedAt: { $gt: cutoff } }).select("author key normalizedText textHistory").sort({ publishedAt: -1 }).limit(1000).lean();
  // Include legacy publications that predate deployment of the durable log.
  const legacy = await FeedPost.find({ author: { $ne: author }, ...(excludePostId ? { _id: { $ne: excludePostId } } : {}), publishedAt: { $gt: cutoff } }).select("author text").sort({ publishedAt: -1 }).limit(1000).lean();
  let nearMatch = null;
  for (const candidate of [...recent, ...legacy]) {
    const variants = [candidate.normalizedText || candidate.text || "", ...(candidate.textHistory || [])];
    const similarity = Math.max(...variants.map(value => normalizeWallText(value) === normalized ? 1 : wallCopySimilarity(normalized, value)));
    if (similarity >= 0.85) {
      const evidence = { exact: variants.some(value => normalizeWallText(value) === normalized), matchedAuthorId: candidate.author, matchedKey: candidate.key || String(candidate._id), matchedPostId: candidate.key ? null : candidate._id, matchedText: variants.find(value => wallCopySimilarity(normalized, value) === similarity), similarity };
      if (evidence.exact) return evidence;
      if (!nearMatch || similarity > nearMatch.similarity) nearMatch = evidence;
    }
  }
  return nearMatch;
}

export async function queueWallCopyReview(post, evidence) {
  if (!evidence) return;
  // A later edit may trigger a fresh hold after an earlier review was resolved.
  await MessageReport.updateOne({ feedPost: post._id, source: "AUTOMATED_DUPLICATE", status: { $in: ["RESOLVED", "CLOSED"] } }, { $set: {
    status: "RECEIVED", snapshot: { text: post.text, previousVisibility: "public", moderationHold: "DUPLICATE", evidence },
    dueAt: new Date(Date.now() + WALL_DAY_MS),
  }, $unset: { resolution: 1, resolvedAt: 1, reviewedBy: 1, reviewingAt: 1 } });
  await MessageReport.updateOne({ feedPost: post._id, source: "AUTOMATED_DUPLICATE" }, { $setOnInsert: {
    reporter: null, reportedUser: post.author?._id || post.author, scope: "FEED_POST", feedPost: post._id,
    source: "AUTOMATED_DUPLICATE", reason: "SPAM", status: "RECEIVED",
    details: "Recent content is substantially similar to another account's note.",
    snapshot: { text: post.text, previousVisibility: "public", moderationHold: "DUPLICATE", evidence },
    dueAt: new Date(Date.now() + WALL_DAY_MS),
  } }, { upsert: true, runValidators: true });
}

export async function registerWallEdit(post, text, now = new Date(), options = {}) {
  const author = post.author?._id || post.author;
  const key = post.creationKey || String(post._id);
  const fingerprint = textHash(text), normalized = normalizeWallText(text);
  const cutoff = new Date(now.getTime() - WALL_DAY_MS);
  if (!fingerprint || !post.publishedAt || post.publishedAt <= cutoff) return;
  await ensureWallLedger(author, cutoff);
  if (await WallPublicationLog.exists({ author, key: { $ne: key }, publishedAt: { $gt: cutoff }, $or: [{ textHash: fingerprint }, { textHistory: normalized }] })) throw new ApiError(409, "You already posted this today", "WALL_DUPLICATE_TEXT");
  const match = { _id: author, "entries.key": key };
  match.$and = [{ entries: { $not: { $elemMatch: { key: { $ne: key }, createdAt: { $gt: cutoff }, $or: [{ textHash: fingerprint }, { textHashes: fingerprint }] } } } }];
  const becomingOffering = wallAccountPolicy(options.user || {}, now).isBusiness && options.postType === "Offering" && post.postType !== "Offering";
  if (becomingOffering) {
    if (await WallPublicationLog.exists({ author, key: { $ne: key }, postType: "Offering", publishedAt: { $gt: cutoff } })) throw new ApiError(429, "Business accounts: one offer a day", "WALL_BUSINESS_OFFERING_LIMIT");
    match.$and.push({ entries: { $not: { $elemMatch: { key: { $ne: key }, postType: "Offering", createdAt: { $gt: cutoff } } } } });
  }
  const updated = await WallCreationLedger.updateOne(match, { $set: { "entries.$.textHash": fingerprint, "entries.$.textHashes": [fingerprint], ...(becomingOffering ? { "entries.$.postType": "Offering" } : {}) } });
  if (becomingOffering && !updated.matchedCount) throw new ApiError(429, "Business accounts: one offer a day", "WALL_BUSINESS_OFFERING_LIMIT");
  if (!updated.matchedCount) throw new ApiError(409, "You already posted this today", "WALL_DUPLICATE_TEXT");
  await WallPublicationLog.updateOne({ author, key }, { $setOnInsert: { author, key, postId: post._id, postType: post.postType, publishedAt: post.publishedAt }, $set: { textHash: fingerprint, normalizedText: normalized, textHistory: [] } }, { upsert: true });
  if (becomingOffering) await WallPublicationLog.updateOne({ author, key }, { $set: { postType: "Offering" } });
}
export function creationKey(req) {
  const value = req.get("Idempotency-Key") || randomUUID();
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(value)) throw new ApiError(400, "Invalid publication request key");
  return value;
}

export function assertNotExactWallCopy(evidence) {
 if (evidence?.exact === true || (evidence?.exact == null && evidence?.similarity === 1)) throw new ApiError(409, "This text is already on the Wall \u2014 say it in your own words", "WALL_CROSS_ACCOUNT_COPY");
}
