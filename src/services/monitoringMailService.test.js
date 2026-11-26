import test from "node:test";
import assert from "node:assert/strict";
import { monitoringMailAdapters, monitoringMailConfigured, monitoringMailProvider, sendMonitoringMail } from "./monitoringMailService.js";
test("monitoring reuses configured Resend without requiring SMTP", async (t) => {
  t.mock.method(monitoringMailAdapters, "emailDeliveryConfigured", () => true);
  let payload;
  t.mock.method(monitoringMailAdapters, "sendEmail", async (input) => { payload = input; return { delivered: true, id: "mock-email-id" }; });
  assert.equal(monitoringMailConfigured(), true);
  assert.equal(monitoringMailProvider(), "resend");
  assert.equal(await sendMonitoringMail({ recipient: "owner@example.test", subject: "Alert", text: "Details", key: "job-123" }), true);
  assert.deepEqual(payload, { to: "owner@example.test", subject: "Alert", text: "Details", idempotencyKey: "monitoring-job-123" });
});
test("rejected or unacknowledged Resend delivery remains a failure for queue retry", async (t) => {
  t.mock.method(monitoringMailAdapters, "emailDeliveryConfigured", () => true);
  const send = t.mock.method(monitoringMailAdapters, "sendEmail", async () => ({ delivered: false }));
  await assert.rejects(sendMonitoringMail({ recipient: "owner@example.test", subject: "Alert", text: "Details" }), /acknowledge/);
  send.mock.mockImplementation(async () => { throw new Error("Provider rejected"); });
  await assert.rejects(sendMonitoringMail({ recipient: "owner@example.test", subject: "Alert", text: "Details" }), /Provider rejected/);
});
