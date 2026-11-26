import crypto from "node:crypto";
import mongoose from "mongoose";
import MonitoringEvent from "../models/MonitoringEvent.js";
import MonitoringAlert from "../models/MonitoringAlert.js";
import MonitoringReport from "../models/MonitoringReport.js";
import MonitoringNotification from "../models/MonitoringNotification.js";
import { monitoringRoute } from "../utils/monitoringPrivacy.js";
import { ERROR_TYPES, errorFrames, DURATION_BOUNDS, percentileUpperBound, reportingPeriodEnd } from "../utils/internalMonitoringPayload.js";
import { monitoringMailConfigured, monitoringRecipients, sendMonitoringMail } from "./monitoringMailService.js";

const queue = [];
let dropped = 0, flushing = false, stopped = true, flushTimer, workerTimer, working = false;
export const monitoringCollectionStatus = () => ({ pending: queue.length, dropped, databaseConnected: mongoose.connection.readyState === 1 });
export function enqueueMonitoringEvent(event) {
  if (queue.length >= 2000) { dropped += 1; return false; }
  queue.push({ eventId: crypto.randomUUID(), createdAt: new Date(), ...event });
  return true;
}
export function recordException(error, { route = "/", status = 500 } = {}) {
  enqueueMonitoringEvent({ source: "server", surface: "api", kind: "error", route: monitoringRoute(route), status, errorType: ERROR_TYPES.includes(error?.name) ? error.name : "Error", frames: errorFrames(error), release: String(process.env.APP_RELEASE || "").slice(0, 80) });
}
export function monitoringRequestMiddleware(req, res, next) {
  if (req.originalUrl.startsWith("/api/monitoring") || req.originalUrl.startsWith("/api/admin/monitoring") || req.originalUrl.startsWith("/api/health") || !req.originalUrl.startsWith("/api/")) return next();
  const started = performance.now();
  res.once("finish", () => {
    enqueueMonitoringEvent({ source: "server", surface: "api", kind: "request", route: monitoringRoute(req.originalUrl), status: res.statusCode, durationMs: Math.min(120000, Math.round(performance.now() - started)) });
    if (res.statusCode >= 500 && !req.monitoringErrorRecorded) recordException({ name: "HttpError" }, { route: req.originalUrl, status: res.statusCode });
  });
  next();
}
async function queueMail(key, subject, text) {
  await Promise.all((await monitoringRecipients()).map((recipient) => MonitoringNotification.updateOne({ key: crypto.createHash("sha256").update(`${key}:${recipient}`).digest("hex") }, { $setOnInsert: { recipient, subject, text } }, { upsert: true })));
}
export async function registerMonitoringAlerts(events) {
  const unique = new Map(events.filter((item) => item.kind === "error").map((event) => [event.alertKey, event]));
  for (const event of unique.values()) {
    const key = crypto.createHash("sha256").update(`${event.surface}:${event.route}:${event.errorType}:${(event.frames || []).join("|")}`).digest("hex");
    const count = await MonitoringEvent.countDocuments({ alertKey: key });
    await MonitoringAlert.updateOne({ key }, { $set: { lastSeenAt: new Date(), state: "open", count }, $setOnInsert: { surface: event.surface, route: event.route, errorType: event.errorType } }, { upsert: true });
    await queueMail(`error:${event.surface}:${Math.floor(Date.now() / 3600000)}`, `[ATSEEN] ${event.surface} error`, `${event.errorType || "Application error"} on ${event.route}\nOpen Administration > Monitoring to review all errors and timings.\nEmail alerts are limited to one per app surface per hour; additional errors remain in the dashboard.\nClient-submitted events are unverified diagnostic reports.`);
  }
}
export async function flushMonitoring() {
  if (flushing || !queue.length || mongoose.connection.readyState !== 1) return;
  flushing = true;
  const batch = queue.splice(0, 200);
  for (const event of batch) if (event.kind === "error") event.alertKey = crypto.createHash("sha256").update(`${event.surface}:${event.route}:${event.errorType}:${(event.frames || []).join("|")}`).digest("hex");
  try {
    await MonitoringEvent.bulkWrite(batch.map((event) => ({ updateOne: { filter: { eventId: event.eventId }, update: { $setOnInsert: event }, upsert: true } })), { ordered: false });
    await registerMonitoringAlerts(batch);
  } catch {
    const room = 2000 - queue.length; queue.unshift(...batch.slice(0, room)); dropped += Math.max(0, batch.length - room);
    console.error("Internal monitoring persistence unavailable; buffered events will retry");
  } finally { flushing = false; }
}

export async function monitoringSummary(start = new Date(Date.now() - 7 * 86400000), end = new Date()) {
  const match = { createdAt: { $gte: start, $lt: end } };
  const [counts, histogram, coverage, uptime] = await Promise.all([
    MonitoringEvent.aggregate([{ $match: match }, { $group: { _id: { surface: "$surface", kind: "$kind" }, count: { $sum: 1 }, failed: { $sum: { $cond: [{ $or: [{ $gte: ["$status", 500] }, { $eq: ["$status", 0] }] }, 1, 0] } } } }]),
    MonitoringEvent.aggregate([{ $match: { ...match, kind: "screen" } }, { $project: { surface: 1, route: 1, upper: { $switch: { branches: DURATION_BOUNDS.map((upper) => ({ case: { $lte: ["$durationMs", upper] }, then: upper })), default: 120000 } }, timedOut: 1 } }, { $group: { _id: { surface: "$surface", route: "$route", upper: "$upper" }, count: { $sum: 1 }, timeouts: { $sum: { $cond: ["$timedOut", 1, 0] } } } }]),
    MonitoringEvent.aggregate([{ $group: { _id: "$surface", lastEventAt: { $max: "$createdAt" } } }]),
    MonitoringEvent.aggregate([{ $match: { ...match, kind: "uptime" } }, { $group: { _id: "$route", checks: { $sum: 1 }, healthy: { $sum: { $cond: [{ $eq: ["$status", 200] }, 1, 0] } }, lastCheckAt: { $max: "$createdAt" } } }]),
  ]);
  const groups = new Map();
  for (const row of histogram) { const key = `${row._id.surface}:${row._id.route}`; const group = groups.get(key) || { surface: row._id.surface, route: row._id.route, buckets: [], loads: 0, timeouts: 0 }; group.buckets.push({ upper: row._id.upper, count: row.count }); group.loads += row.count; group.timeouts += row.timeouts; groups.set(key, group); }
  const screens = [...groups.values()].map(({ buckets, ...group }) => ({ ...group, p50UpperMs: percentileUpperBound(buckets, 0.5), p95UpperMs: percentileUpperBound(buckets, 0.95) })).sort((a, b) => b.p95UpperMs - a.p95UpperMs).slice(0, 100);
  return { periodStart: start, periodEnd: end, counts: counts.map((row) => ({ surface: row._id.surface, kind: row._id.kind, count: row.count, failed: row.failed, failureRate: row._id.kind === "request" && row.count ? row.failed / row.count : null })), screens, coverage, uptime, percentileMethod: "Histogram upper bounds; not exact percentiles", clientDataTrust: "Client telemetry is unverified; API request metrics are server-observed" };
}
export async function ensureWeeklyReport(now = new Date()) {
  const periodEnd = reportingPeriodEnd(now);
  let report = await MonitoringReport.findOne({ periodEnd }).lean();
  if (!report) {
    const periodStart = new Date(periodEnd.getTime() - 7 * 86400000);
    const summary = await monitoringSummary(periodStart, periodEnd);
    try { report = (await MonitoringReport.create({ periodStart, periodEnd, summary })).toObject(); }
    catch (error) { if (error.code !== 11000) throw error; report = await MonitoringReport.findOne({ periodEnd }).lean(); }
  }
  await queueMail(`weekly:${periodEnd.toISOString()}`, "[ATSEEN] Weekly error rate and screen speed", JSON.stringify(report.summary, null, 2));
  return report;
}
export async function deliverMonitoringNotifications() {
  if (!monitoringMailConfigured()) return;
  for (let index = 0; index < 10; index += 1) {
    const job = await MonitoringNotification.findOneAndUpdate({ deliveredAt: null, cancelledAt: null, nextAttemptAt: { $lte: new Date() }, $or: [{ leaseUntil: null }, { leaseUntil: { $lt: new Date() } }] }, { $set: { leaseUntil: new Date(Date.now() + 60000) } }, { sort: { createdAt: 1 }, new: true });
    if (!job) break;
    if (!(await monitoringRecipients()).includes(job.recipient.toLowerCase())) { await MonitoringNotification.updateOne({ _id: job._id }, { $set: { cancelledAt: new Date(), leaseUntil: null } }); continue; }
    try { if (!await sendMonitoringMail(job)) break; await MonitoringNotification.updateOne({ _id: job._id }, { $set: { deliveredAt: new Date(), leaseUntil: null }, $inc: { attempts: 1 } }); }
    catch { await MonitoringNotification.updateOne({ _id: job._id }, { $set: { leaseUntil: null, nextAttemptAt: new Date(Date.now() + Math.min(3600000, 60000 * 2 ** Math.min(job.attempts, 6))) }, $inc: { attempts: 1 } }); }
  }
}
export function startInternalMonitoring() {
  if (!stopped) return;
  stopped = false;
  flushTimer = setInterval(() => { void flushMonitoring(); }, 5000); flushTimer.unref();
  const run = async () => { if (working || stopped) return; working = true; try { await ensureWeeklyReport(); await deliverMonitoringNotifications(); } catch { console.error("Internal monitoring report or delivery failed; will retry"); } finally { working = false; } };
  workerTimer = setInterval(() => { void run(); }, 60000); workerTimer.unref(); void run();
}
export async function stopInternalMonitoring() { stopped = true; clearInterval(flushTimer); clearInterval(workerTimer); await flushMonitoring(); }
