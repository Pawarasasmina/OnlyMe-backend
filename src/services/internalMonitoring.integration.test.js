import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import MonitoringEvent from "../models/MonitoringEvent.js";
import MonitoringAlert from "../models/MonitoringAlert.js";
import MonitoringReport from "../models/MonitoringReport.js";
import MonitoringNotification from "../models/MonitoringNotification.js";
import { enqueueMonitoringEvent, flushMonitoring, monitoringSummary, ensureWeeklyReport } from "./internalMonitoringService.js";
import { reportingPeriodEnd, sanitizeClientEvent } from "../utils/internalMonitoringPayload.js";
import express from "express";
import http from "node:http";
import monitoringRoutes from "../routes/monitoringRoutes.js";
import { getMonitoringStatus } from "../controllers/monitoringController.js";
import User from "../models/User.js";
import { monitoringRecipients, monitoringMailAdapters } from "./monitoringMailService.js";
import { deliverMonitoringNotifications } from "./internalMonitoringService.js";

test("isolated MongoDB: internal events, alerts, percentiles, idempotent retries and weekly reports", { timeout: 180000 }, async (t) => {
  // No application database or email delivery is used by this test.
  const mongo = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongo.getUri());
    await Promise.all([MonitoringEvent.init(), MonitoringAlert.init(), MonitoringReport.init(), MonitoringNotification.init()]);
    await User.collection.insertMany([
      { role: "admin", username: "monitor-main", adminRole: "MAIN_ADMIN", status: "active", email: "main@example.test" },
      { role: "admin", username: "monitor-mod", adminRole: "MODERATOR", status: "active", email: "moderator@example.test" },
      { role: "admin", username: "monitor-finance", adminRole: "FINANCE", status: "active", email: "finance@example.test" },
      { role: "admin", username: "monitor-suspended", adminRole: "MODERATOR", status: "suspended", email: "suspended@example.test" },
      { role: "fan", username: "monitor-fan", status: "active", email: "fan@example.test" },
    ]);
    assert.deepEqual((await monitoringRecipients()).sort(), ["main@example.test", "moderator@example.test"]);
    const periodEnd = reportingPeriodEnd();
    const createdAt = new Date(periodEnd.getTime() - 3600000);
    const base = { source: "server", surface: "api", route: "/api/users", createdAt };
    enqueueMonitoringEvent({ ...base, eventId: "request-good", kind: "request", status: 200 });
    enqueueMonitoringEvent({ ...base, eventId: "request-bad", kind: "request", status: 500 });
    const error = sanitizeClientEvent({ eventId: "error-test-id", surface: "web", kind: "error", route: "/users/private?secret=token", errorType: "TypeError", message: "private identity" });
    enqueueMonitoringEvent({ ...error, createdAt });
    enqueueMonitoringEvent({ ...base, eventId: "screen-fast", surface: "web", kind: "screen", durationMs: 900 });
    enqueueMonitoringEvent({ ...base, eventId: "screen-slow", surface: "web", kind: "screen", durationMs: 6200 });
    await flushMonitoring();
    enqueueMonitoringEvent({ ...error, createdAt }); await flushMonitoring();
    assert.equal(await MonitoringEvent.countDocuments(), 5);
    assert.equal((await MonitoringAlert.findOne()).count, 1);
    const summary = await monitoringSummary(new Date(createdAt.getTime() - 1000), periodEnd);
    assert.equal(summary.counts.find((row) => row.surface === "api" && row.kind === "request").failureRate, .5);
    assert.equal(summary.screens[0].p95UpperMs, 7000);
    assert.equal(summary.screens[0].p50UpperMs, 1000);
    assert.equal(JSON.stringify(await MonitoringEvent.find().lean()).includes("private identity"), false);
    await ensureWeeklyReport(); await ensureWeeklyReport();
    assert.equal(await MonitoringReport.countDocuments(), 1);
    assert.ok(await MonitoringNotification.countDocuments());
    const app = express(); app.use(express.json()); app.get("/status", getMonitoringStatus); app.use(monitoringRoutes);
    const server = http.createServer(app); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const oldToken = process.env.MONITOR_WATCHDOG_TOKEN;
    process.env.MONITOR_WATCHDOG_TOKEN = "isolated-test-token-12345678901234567890";
    try {
      const post = (path, body, token = "") => fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
      assert.equal((await post("/events", { events: [{ eventId: "forged-id-123", surface: "api", kind: "error" }] })).status, 400);
      assert.equal((await post("/events", { events: [{ eventId: "http-client-id", surface: "web", kind: "screen", route: "/seen", durationMs: 500 }] })).status, 202);
      await flushMonitoring(); assert.equal((await MonitoringEvent.findOne({ eventId: "http-client-id" })).source, "client");
      const samples = [{ at: new Date().toISOString(), checks: [{ target: "web", healthy: true, durationMs: 10 }, { target: "api", healthy: false, durationMs: 20 }] }];
      assert.equal((await post("/watchdog", { samples })).status, 403);
      assert.equal((await post("/watchdog", { samples }, process.env.MONITOR_WATCHDOG_TOKEN)).status, 202);
      assert.equal((await post("/watchdog", { samples }, process.env.MONITOR_WATCHDOG_TOKEN)).status, 202);
      assert.equal(await MonitoringEvent.countDocuments({ kind: "uptime" }), 2);
      assert.ok(await MonitoringEvent.exists({ kind: "heartbeat" }));
      const status = await (await fetch(`${baseUrl}/status`)).json();
      assert.equal(status.data.watchdog.fresh, true);
      assert.ok(status.data.watchdog.lastCheckReceivedAt);
      assert.ok(status.data.alerts[0].lastOccurrenceAt);
      assert.ok(status.data.reports.length);
      const delivered = [];
      t.mock.method(monitoringMailAdapters, "emailDeliveryConfigured", () => true);
      t.mock.method(monitoringMailAdapters, "sendEmail", async ({ to }) => { delivered.push(to); return { delivered: true, id: "mock-mail" }; });
      await User.updateOne({ email: "moderator@example.test" }, { $set: { status: "suspended" } });
      await MonitoringNotification.create({ key: "old-personal-job", recipient: "old-personal@example.test", subject: "Old alert", text: "Details" });
      await deliverMonitoringNotifications();
      assert.ok(delivered.length);
      assert.ok(delivered.every((email) => email === "main@example.test"));
      assert.ok(await MonitoringNotification.exists({ recipient: "old-personal@example.test", cancelledAt: { $ne: null } }));
    } finally {
      if (oldToken === undefined) delete process.env.MONITOR_WATCHDOG_TOKEN; else process.env.MONITOR_WATCHDOG_TOKEN = oldToken;
      await new Promise((resolve) => server.close(resolve));
    }
  } finally { await mongoose.disconnect(); await mongo.stop(); }
});
