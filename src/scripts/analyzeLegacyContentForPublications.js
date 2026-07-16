import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import Content from "../models/Content.js";
import User from "../models/User.js";

export function classifyLegacyContent(item) {
  const published = ["PUBLISHED", "published"].includes(item.status); const hasBody = Boolean(String(item.body || item.description || "").trim()); const hasMedia = Boolean(item.media?.length || item.images?.length);
  if (!item.creator) return { candidate: "AMBIGUOUS", confidence: "NONE", reason: "Missing creator" };
  if (item.accessLevel === "PAY_PER_VIEW") return { candidate: "WORLD", confidence: "LOW", reason: "PPV resembles one-time access but has no chapters" };
  if (["SUBSCRIBER_ONLY", "subscribers"].includes(item.accessLevel)) return { candidate: "PREMIUM_WORLD", confidence: "LOW", reason: "Subscriber access resembles membership but has no chapter policy" };
  if (item.accessLevel === "PUBLIC" && item.contentType === "TEXT" && hasBody) return { candidate: "WALL_NOTE", confidence: "MEDIUM", reason: "Short public text is Wall-like" };
  if (item.accessLevel === "PUBLIC" && published && (hasBody || hasMedia)) return { candidate: "SEEN", confidence: "LOW", reason: "Public published content could become a Seen or Wall Note" };
  return { candidate: "AMBIGUOUS", confidence: "NONE", reason: "No safe automatic classification" };
}

export function buildLegacyAnalysis(items, creatorIds = new Set()) {
  const report = { version: 1, total: items.length, counts: { type: {}, access: {}, status: {}, candidate: {} }, missingCreator: [], invalidMedia: [], restricted: [], planetLimitConflicts: [], records: [] }; const planets = new Map();
  for (const item of items) { for (const [bucket, value] of [["type", item.contentType], ["access", item.accessLevel], ["status", item.status]]) report.counts[bucket][value || "MISSING"] = (report.counts[bucket][value || "MISSING"] || 0) + 1; const creatorExists = item.creator && creatorIds.has(String(item.creator)); const classification = classifyLegacyContent({ ...item, creator: creatorExists ? item.creator : null }); report.counts.candidate[classification.candidate] = (report.counts.candidate[classification.candidate] || 0) + 1; if (!creatorExists) report.missingCreator.push(String(item._id)); if (!["TEXT"].includes(item.contentType) && !(item.media?.length || item.images?.length)) report.invalidMedia.push(String(item._id)); if (["PAY_PER_VIEW", "SUBSCRIBER_ONLY", "subscribers"].includes(item.accessLevel)) report.restricted.push(String(item._id)); if (["WORLD", "PREMIUM_WORLD"].includes(classification.candidate) && creatorExists) { const key = String(item.creator); planets.set(key, [...(planets.get(key) || []), String(item._id)]); } report.records.push({ id: String(item._id), creator: item.creator ? String(item.creator) : null, ...classification, requiresManualClassification: classification.confidence !== "HIGH" }); }
  report.planetLimitConflicts = [...planets.entries()].filter(([, ids]) => ids.length > 3).map(([creator, ids]) => ({ creator, ids })); return report;
}

async function run() { const outputArg = process.argv.find((arg) => arg.startsWith("--output=")); if (!outputArg) throw new Error("Use --output=<immutable-report.json>"); const output = path.resolve(outputArg.slice(9)); await connectDb(); const items = await Content.find().lean(); const creatorIds = new Set((await User.find({ role: "creator" }).select("_id").lean()).map((item) => String(item._id))); const report = buildLegacyAnalysis(items, creatorIds); await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, JSON.stringify(report, null, 2), { flag: "wx" }); console.log(`Dry-run report written to ${output}`); await mongoose.disconnect(); }
const invoked = process.argv[1]?.replaceAll("\\", "/"); if (invoked?.endsWith("/analyzeLegacyContentForPublications.js")) run().catch((error) => { console.error(error); process.exitCode = 1; });
