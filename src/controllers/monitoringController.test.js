import test from "node:test";
import assert from "node:assert/strict";
import { requireAdminRole } from "../middleware/adminPermissionMiddleware.js";
import { sanitizeClientEvent, percentileUpperBound, reportingPeriodEnd, errorFrames } from "../utils/internalMonitoringPayload.js";
test("only Main Admin can read operational monitoring", () => {
  for (const adminRole of ["FINANCE", "MODERATOR"]) requireAdminRole("MAIN_ADMIN")({ user: { role: "admin", adminRole } }, {}, (error) => assert.equal(error.statusCode, 403));
});
test("client telemetry cannot claim server or watchdog observations or submit private fields", () => {
  assert.equal(sanitizeClientEvent({ eventId: "valid-event-id", surface: "api", kind: "error" }), null);
  const event = sanitizeClientEvent({ eventId: "valid-event-id", surface: "web", kind: "error", route: "/api/users/person@example.com?token=secret", message: "secret", request: { token: "secret" }, frames: ["file.js:12:1", "secret"], status: 999, durationMs: -5 });
  assert.equal(JSON.stringify(event).includes("secret"), false);
  assert.equal(event.source, "client"); assert.equal(event.route, "/api/users/:id"); assert.equal(event.durationMs, 0);
  assert.deepEqual(event.frames, ["file.js:12:1"]);
});
test("stack frames exclude exception text and private paths", () => {
  assert.deepEqual(errorFrames({ stack: "TypeError: secret\n at x (https://host/private/file.js:12:3)" }), ["file.js:12:3"]);
});
test("weekly reports use Monday 09:00 Colombo and histogram bounds", () => {
  assert.equal(reportingPeriodEnd(new Date("2026-11-30T03:29:00Z")).toISOString(), "2026-11-23T03:30:00.000Z");
  assert.equal(reportingPeriodEnd(new Date("2026-11-30T03:30:00Z")).toISOString(), "2026-11-30T03:30:00.000Z");
  assert.equal(percentileUpperBound([{ upper: 1000, count: 90 }, { upper: 7000, count: 10 }], .95), 7000);
  assert.equal(percentileUpperBound([], .95), null);
});