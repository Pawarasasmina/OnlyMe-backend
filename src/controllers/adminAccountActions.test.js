import assert from "node:assert/strict";
import test from "node:test";
import User from "../models/User.js";
import AdminAuditEvent from "../models/AdminAuditEvent.js";
import { updateUserStatus, bulkUpdateUsers } from "./adminController.js";

const id = "507f1f77bcf86cd799439011";
const actor = "507f191e810c19729de860ea";
const request = (body) => ({ params: { userId: id }, body, user: { _id: actor, role: "admin", adminRole: "MODERATOR" } });
const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test("single and bulk endpoints reject missing reason or confirmation before mutation", async (t) => {
  t.mock.method(User, "findByIdAndUpdate", () => assert.fail("must not mutate"));
  t.mock.method(User, "updateMany", () => assert.fail("must not mutate"));
  for (const handler of [updateUserStatus, bulkUpdateUsers]) {
    for (const extra of [{ confirmed: true }, { reason: "Policy violation" }]) {
      let error;
      await handler(request({ userIds: [id], status: "suspended", ...extra }), response(), (value) => { error = value; });
      assert.equal(error?.statusCode, 400);
    }
  }
});

test("suspend and activate write visible audit events with actor, target, states and reason", async (t) => {
  const events = [];
  let status = "active";
  t.mock.method(User, "findById", () => ({ select: async () => ({ _id: id, status, role: "fan", dateOfBirth: "1990-01-01" }) }));
  t.mock.method(User, "findByIdAndUpdate", (_id, update) => ({ select: async () => { status = update.$set.status; return { _id: id, status }; } }));
  t.mock.method(AdminAuditEvent, "create", async (event) => { events.push(event); });
  for (const nextStatus of ["suspended", "active"]) {
    const res = response();
    await updateUserStatus(request({ status: nextStatus, reason: "Reviewed test account", confirmed: true }), res, (error) => { throw error; });
    assert.equal(res.code, 200);
  }
  assert.equal(events.length, 2);
  assert.equal(events[0].actor, actor);
  assert.equal(events[0].actorRole, "MODERATOR");
  assert.equal(events[0].targetId, id);
  assert.equal(events[0].reason, "Reviewed test account");
  assert.deepEqual(events.map((event) => [event.before.status, event.after.status]), [["active", "suspended"], ["suspended", "active"]]);
});

test("bulk actions write one visible audit event per target", async (t) => {
  let events;
  t.mock.method(User, "find", () => ({ select: async () => [{ _id: id, status: "active", role: "fan", accountType: "TEST" }] }));
  t.mock.method(User, "updateMany", async () => ({}));
  t.mock.method(AdminAuditEvent, "insertMany", async (items) => { events = items; });
  await bulkUpdateUsers(request({ userIds: [id], status: "suspended", reason: "Bulk review complete", confirmed: true }), response(), (error) => { throw error; });
  assert.equal(events.length, 1);
  assert.equal(events[0].targetId, id);
  assert.equal(events[0].after.status, "suspended");
  assert.equal(events[0].metadata.bulk, true);
});
