import { sendResponse } from "../utils/response.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { monitoringCollectionStatus, monitoringSummary, flushMonitoring } from "../services/internalMonitoringService.js";
import { monitoringMailConfigured, monitoringMailProvider, monitoringRecipients } from "../services/monitoringMailService.js";
import MonitoringEvent from "../models/MonitoringEvent.js";
import MonitoringAlert from "../models/MonitoringAlert.js";
import MonitoringReport from "../models/MonitoringReport.js";
import MonitoringNotification from "../models/MonitoringNotification.js";

export const getMonitoringStatus = asyncHandler(async (_req, res) => {
  await flushMonitoring();
  const [summary, errors, alerts, reports, notificationCounts, heartbeat] = await Promise.all([
    monitoringSummary(), MonitoringEvent.find({ kind: "error" }).sort({ createdAt: -1 }).limit(30).lean(), MonitoringAlert.find({ state: "open" }).sort({ lastSeenAt: -1 }).limit(30).lean(), MonitoringReport.find().sort({ periodEnd: -1 }).limit(4).lean(), MonitoringNotification.aggregate([{ $group: { _id: { $cond: ["$cancelledAt", "cancelled", { $cond: ["$deliveredAt", "accepted_by_provider", { $cond: [{ $gt: ["$attempts", 0] }, "retrying", "pending"] }] }] }, count: { $sum: 1 } } }]), MonitoringEvent.findOne({ source: "watchdog", kind: "heartbeat" }).sort({ createdAt: -1 }).lean(),
  ]);
  const recipients = await monitoringRecipients();
  return sendResponse(res, 200, "Internal monitoring", { summary, errors, alerts: alerts.map((alert) => ({ ...alert, lastOccurrenceAt: alert.lastSeenAt })), reports, collection: monitoringCollectionStatus(), email: { configured: monitoringMailConfigured(), provider: monitoringMailProvider(), recipients, teamConfigured: recipients.length > 0, recipientSource: "Active Main Admin and Moderator accounts", counts: notificationCounts }, watchdog: { lastCheckReceivedAt: heartbeat?.createdAt || null, fresh: Boolean(heartbeat && Date.now() - new Date(heartbeat.createdAt).getTime() < 150000) }, weeklySchedule: "Monday 09:00 Asia/Colombo", nativeCrashCoverage: "JavaScript errors only. Native iOS crashes require device crash logs." });
});
