import { env } from "../config/env.js";

let consecutiveFailures = 0;
let incidentOpen = false;
let lastAlertAt = 0;

async function notify(payload) {
  if (!env.uptimeAlertWebhook) return;
  try {
    await fetch(env.uptimeAlertWebhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
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
      const incident = { event: "API_UNAVAILABLE", status: res.statusCode, path: req.originalUrl, method: req.method, durationMs, consecutiveFailures, occurredAt: new Date().toISOString() };
      console.error("Uptime incident", incident);
      void notify(incident);
    } else if (!failed && incidentOpen) {
      incidentOpen = false;
      const recovery = { event: "API_RECOVERED", path: req.originalUrl, durationMs, recoveredAt: new Date().toISOString() };
      console.info("Uptime recovered", recovery);
      void notify(recovery);
    }
  });
  next();
}
