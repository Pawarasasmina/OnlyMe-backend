import assert from "node:assert/strict";
import test from "node:test";
import { normalizeModerationReport } from "./moderationMetricsService.js";

test("urgent safety reports receive the four-hour SLA when no deadline is stored", () => {
  const createdAt = new Date("2026-11-26T00:00:00.000Z");
  const report = normalizeModerationReport({ _id: "report-1", reason: "VIOLENCE", status: "RECEIVED", createdAt }, "MessageReport", new Date("2026-11-26T03:00:00.000Z"));
  assert.equal(report.priority, "URGENT");
  assert.equal(report.dueAt.toISOString(), "2026-11-26T04:00:00.000Z");
  assert.equal(report.overdue, false);
});

test("standard reports receive the 24-hour SLA and overdue state from the same normalizer", () => {
  const createdAt = new Date("2026-11-25T00:00:00.000Z");
  const report = normalizeModerationReport({ _id: "report-2", reason: "SPAM", status: "RECEIVED", createdAt }, "PublicationReport", new Date("2026-11-26T01:00:00.000Z"));
  assert.equal(report.priority, "STANDARD");
  assert.equal(report.dueAt.toISOString(), "2026-11-26T00:00:00.000Z");
  assert.equal(report.overdue, true);
});
