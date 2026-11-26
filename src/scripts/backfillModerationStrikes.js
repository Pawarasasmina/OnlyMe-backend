import mongoose from "mongoose";
import { env } from "../config/env.js";
import MessageReport from "../models/MessageReport.js";
import PublicationReport from "../models/PublicationReport.js";
import ModerationStrike from "../models/ModerationStrike.js";
import { applyResolvedCaseStrike } from "../services/moderationEnforcementService.js";

const apply = process.argv.includes("--apply");
const excluded = [null, "", "NO_ACTION", "RESTRICTION_LIFTED"];
const target = (row, model) => model === "PublicationReport" ? row.publication : row.message || row.groupMessage || row.feedPost || row.profileMedia || row.story || row.commentId || row.publication || row.reportedUser;
const key = (row, model) => `${row.reportedUser || row.creator}:${row.scope || row.kind}:${target(row, model)}:${new Date(row.resolvedAt).toISOString()}`;

try {
  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 10000 });
  const [messages, publications] = await Promise.all([
    MessageReport.find({ status: { $in: ["RESOLVED", "CLOSED"] }, "resolution.action": { $nin: excluded }, "resolution.falseReport": { $ne: true }, resolvedAt: { $ne: null } }).sort({ resolvedAt: 1 }),
    PublicationReport.find({ status: { $in: ["RESOLVED", "CLOSED"] }, "resolution.action": { $nin: excluded }, resolvedAt: { $ne: null } }).sort({ resolvedAt: 1 }),
  ]);
  const cases = new Map();
  for (const [rows, model] of [[messages, "MessageReport"], [publications, "PublicationReport"]]) for (const row of rows) if (!cases.has(key(row, model))) cases.set(key(row, model), { report: row, reportModel: model });
  const existing = await ModerationStrike.countDocuments();
  console.log(JSON.stringify({ database: mongoose.connection.name, apply, resolvedReports: messages.length + publications.length, uniqueCases: cases.size, existingStrikes: existing, wouldCreateAtMost: Math.max(0, cases.size - existing) }, null, 2));
  if (apply) for (const item of cases.values()) await applyResolvedCaseStrike({ ...item, actorId: item.report.reviewedBy });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
