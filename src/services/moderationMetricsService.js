import MessageReport from "../models/MessageReport.js";
import PublicationReport from "../models/PublicationReport.js";
import { URGENT_REPORT_REASONS } from "../constants/reportConstants.js";

export { URGENT_REPORT_REASONS } from "../constants/reportConstants.js";
const closed = (status) => ["RESOLVED", "CLOSED"].includes(status);
export function normalizeModerationReport(row, model, now = new Date()) {
  const reason = row.reason || "OTHER"; const urgent = row.priority === "URGENT" || URGENT_REPORT_REASONS.has(reason);
  const createdAt = new Date(row.createdAt); const configuredDue = new Date(row.dueAt || 0);
  const dueAt = Number.isFinite(configuredDue.getTime()) && configuredDue.getTime() > 0 ? configuredDue : new Date(createdAt.getTime() + (urgent ? 4 : 24) * 3600000);
  const author = model === "MessageReport" ? row.reportedUser : row.creator;
  return { ...row, id: row._id, model, author, priority: urgent ? "URGENT" : "STANDARD", priorityRank: urgent ? 2 : 1, dueAt, overdue: !closed(row.status) && dueAt < now };
}
const percentWithin = (rows, milliseconds) => rows.length ? Math.round(rows.filter((row) => new Date(row.resolvedAt) - new Date(row.createdAt) <= milliseconds).length / rows.length * 100) : null;
const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
export async function getModerationMetrics(now = new Date()) {
  const [openMessages, openPublications, resolvedMessages, resolvedPublications] = await Promise.all([
    MessageReport.find({ status: { $in: ["RECEIVED", "REVIEWING"] } }).select("reason priority dueAt createdAt reviewingAt reviewedBy reportedUser status").lean(),
    PublicationReport.find({ status: { $in: ["RECEIVED", "REVIEWING"] } }).select("reason priority dueAt createdAt reviewingAt reviewedBy creator status").lean(),
    MessageReport.find({ resolvedAt: { $ne: null } }).select("reason priority createdAt reviewingAt resolvedAt").sort({ resolvedAt: -1 }).limit(5000).lean(),
    PublicationReport.find({ resolvedAt: { $ne: null } }).select("reason priority createdAt reviewingAt resolvedAt").sort({ resolvedAt: -1 }).limit(5000).lean(),
  ]);
  const open = [...openMessages.map((row) => normalizeModerationReport(row, "MessageReport", now)), ...openPublications.map((row) => normalizeModerationReport(row, "PublicationReport", now))];
  const resolved = [...resolvedMessages.map((row) => normalizeModerationReport(row, "MessageReport", now)), ...resolvedPublications.map((row) => normalizeModerationReport(row, "PublicationReport", now))];
  const urgentResolved = resolved.filter((row) => row.priority === "URGENT"); const standardResolved = resolved.filter((row) => row.priority !== "URGENT");
  const resolutionTimes = resolved.map((row) => new Date(row.resolvedAt) - new Date(row.createdAt)).filter(Number.isFinite);
  const pickupTimes = resolved.filter((row) => row.reviewingAt).map((row) => new Date(row.reviewingAt) - new Date(row.createdAt)).filter(Number.isFinite);
  return { openRows: open, summary: { open: open.length, urgent: open.filter((row) => row.priority === "URGENT").length, standard: open.filter((row) => row.priority !== "URGENT").length, overdue: open.filter((row) => row.overdue).length, dueSoon: open.filter((row) => !row.overdue && new Date(row.dueAt) - now <= 4 * 3600000).length, unacknowledged: open.filter((row) => !row.reviewingAt).length, oldestOpenAt: open.length ? open.reduce((oldest, row) => new Date(row.createdAt) < new Date(oldest) ? row.createdAt : oldest, open[0].createdAt) : null, urgentWithin4Percent: percentWithin(urgentResolved, 4 * 3600000), standardWithin24Percent: percentWithin(standardResolved, 24 * 3600000), medianPickupMinutes: pickupTimes.length ? Math.round(median(pickupTimes) / 60000) : null, medianResolutionMinutes: resolutionTimes.length ? Math.round(median(resolutionTimes) / 60000) : null, resolvedSampleSize: resolved.length } };
}
