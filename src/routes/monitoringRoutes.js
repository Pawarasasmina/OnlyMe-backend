import { Router } from "express";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sanitizeClientEvent } from "../utils/internalMonitoringPayload.js";
import { enqueueMonitoringEvent } from "../services/internalMonitoringService.js";
import MonitoringEvent from "../models/MonitoringEvent.js";
import { monitoringRecipients } from "../services/monitoringMailService.js";
const router = Router();
router.post("/events", rateLimit({ windowMs: 60000, limit: 30, standardHeaders: true, legacyHeaders: false }), (req, res) => {
  if (JSON.stringify(req.body || {}).length > 32768 || !Array.isArray(req.body?.events) || !req.body.events.length || req.body.events.length > 20) return res.status(400).json({ message: "Invalid telemetry batch" });
  const events = req.body.events.map(sanitizeClientEvent);
  if (events.some((event) => !event)) return res.status(400).json({ message: "Invalid telemetry event" });
  const accepted = events.filter(enqueueMonitoringEvent).length;
  return res.status(accepted === events.length ? 202 : 503).json({ accepted });
});
router.post("/watchdog", rateLimit({ windowMs: 60000, limit: 10, standardHeaders: true, legacyHeaders: false }), asyncHandler(async (req, res) => {
  const secret = process.env.MONITOR_WATCHDOG_TOKEN || "";
  const provided = String(req.get("Authorization") || "").replace(/^Bearer /, "");
  if (secret.length < 32 || secret.length !== provided.length || !crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(provided))) return res.status(403).json({ message: "Watchdog access denied" });
  const samples = req.body?.samples;
  if (!Array.isArray(samples) || !samples.length || samples.length > 20 || samples.some((sample) => !sample || !Number.isFinite(new Date(sample.at).getTime()) || new Date(sample.at).getTime() > Date.now() + 30000 || new Date(sample.at).getTime() < Date.now() - 30 * 86400000 || !Array.isArray(sample.checks) || sample.checks.length !== 2 || new Set(sample.checks.map((check) => check.target)).size !== 2 || sample.checks.some((check) => !check || !["web", "api"].includes(check.target) || typeof check.healthy !== "boolean"))) return res.status(400).json({ message: "Invalid watchdog samples" });
  const events = samples.flatMap((sample) => sample.checks.map((check) => ({ eventId: crypto.createHash("sha256").update(`${sample.at}:${check.target}`).digest("hex"), source: "watchdog", surface: "watchdog", kind: "uptime", route: `/${check.target}`, status: check.healthy ? 200 : 0, durationMs: Math.min(120000, Math.max(0, Number(check.durationMs) || 0)), createdAt: new Date(sample.at) })));
  await MonitoringEvent.bulkWrite(events.map((event) => ({ updateOne: { filter: { eventId: event.eventId }, update: { $setOnInsert: event }, upsert: true } })), { ordered: false });
  await MonitoringEvent.create({ eventId: crypto.randomUUID(), source: "watchdog", surface: "watchdog", kind: "heartbeat", route: "/watchdog", status: 200 });
  return res.status(202).json({ accepted: samples.length, recipients: await monitoringRecipients() });
}));
export default router;
