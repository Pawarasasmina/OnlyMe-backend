import { env } from "../config/env.js";
import { sendOwnerOperationalAlert } from "../services/operationalAlertService.js";
import { monitoringRoute } from "../utils/monitoringPrivacy.js";

let consecutiveFailures = 0;
let incidentOpen = false;
let lastAlertAt = 0;

async function notify(payload) {
  if (!env.uptimeAlertWebhook) return;
  try {
    const response = await fetch(env.uptimeAlertWebhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Alert webhook returned ${response.status}`);
  } catch (error) {
    console.error("Uptime alert delivery failed", { message: error.message });
  }
}

export function uptimeAlertMiddleware(req, res, next) {
  const startedAt = Date.now();
  res.on("finish", () => {
    if (req.originalUrl.startsWith("/api/health")) return;
    const durationMs = Date.now() - startedAt;
    const failed = res.statusCode >= 500;
    consecutiveFailures = failed ? consecutiveFailures + 1 : 0;

    if (failed && consecutiveFailures >= 3 && Date.now() - lastAlertAt > 60000) {
      incidentOpen = true;
      lastAlertAt = Date.now();
      const incident = { event: "API_UNAVAILABLE", status: res.statusCode, path: monitoringRoute(req.originalUrl), method: req.method, durationMs, consecutiveFailures, occurredAt: new Date().toISOString() };
      console.error("Uptime incident", incident);
      void notify(incident);
      void sendOwnerOperationalAlert("DOWNTIME", `DOWNTIME:${Math.floor(Date.now() / 300000)}`, `🔴 @seen API incident\n${consecutiveFailures} consecutive server errors\nStatus: ${res.statusCode}\nTime: ${incident.occurredAt}`);
    } else if (!failed && incidentOpen) {
      incidentOpen = false;
      const recovery = { event: "API_RECOVERED", path: monitoringRoute(req.originalUrl), durationMs, recoveredAt: new Date().toISOString() };
      console.info("Uptime recovered", recovery);
      void notify(recovery);
      void sendOwnerOperationalAlert("RECOVERY", `RECOVERY:${Math.floor(Date.now() / 300000)}`, `✅ @seen API recovered\nTime: ${recovery.recoveredAt}`);
    }
  });
  next();
}
