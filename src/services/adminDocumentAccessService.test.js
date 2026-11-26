import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";
import AdminAuditEvent from "../models/AdminAuditEvent.js";
import { auditDocumentView } from "./adminDocumentAccessService.js";

test("each document delivery records actor and document without sensitive contents", async (t) => {
  const events = [];
  t.mock.method(AdminAuditEvent, "create", async (event) => { events.push(event); });
  const req = { user: { _id: "reviewer", role: "admin", adminRole: "MODERATOR" }, ip: "127.0.0.1", get: () => "browser" };
  const stream = new PassThrough();
  await auditDocumentView(req, stream, "CREATOR_VERIFICATION", "application", "selfie");
  await auditDocumentView(req, stream, "CREATOR_VERIFICATION", "application", "selfie");
  assert.equal(events.length, 2);
  assert.equal(events[0].actor, "reviewer");
  assert.equal(events[0].actorRole, "MODERATOR");
  assert.equal(events[0].metadata.documentType, "selfie");
  assert.equal(events[0].targetId, "application");
  assert.equal(stream.destroyed, false);
  stream.destroy();
});

test("audit failure closes document stream and fails the request", async (t) => {
  t.mock.method(AdminAuditEvent, "create", async () => { throw new Error("audit unavailable"); });
  const stream = new PassThrough();
  await assert.rejects(auditDocumentView({ user: { role: "admin" }, get: () => "" }, stream, "BUSINESS_VERIFICATION", "application", "document"), /audit unavailable/);
  assert.equal(stream.destroyed, true);
});
