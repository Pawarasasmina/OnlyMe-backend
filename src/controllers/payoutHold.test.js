import test from "node:test";
import assert from "node:assert/strict";
import User from "../models/User.js";
import PayoutHold from "../models/PayoutHold.js";
import Payout from "../models/Payout.js";
import AdminAuditEvent from "../models/AdminAuditEvent.js";
import { holdPayouts, releasePayouts } from "./adminOperationsController.js";
import { transitionPayout } from "../services/payoutService.js";

const id = "507f1f77bcf86cd799439011";
const req = (reason) => ({ params: { id }, body: { reason }, user: { _id: id, role: "admin", adminRole: "FINANCE" } });
const res = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
test("hold and release persist state and both write visible audit events", async (t) => {
  const events = [];
  let activeHold = null;
  t.mock.method(User, "exists", async () => true);
  t.mock.method(PayoutHold, "findOne", async () => activeHold);
  t.mock.method(PayoutHold, "create", async (value) => {
    activeHold = { _id: id, active: true, seriousCaseRefs: [], ...value, async save() { return this; } };
    return activeHold;
  });
  t.mock.method(AdminAuditEvent, "create", async (event) => events.push(event));
  await holdPayouts(req("Review required"), res(), (error) => { throw error; });
  await releasePayouts(req("Review complete"), res(), (error) => { throw error; });
  assert.deepEqual(events.map((e) => e.action), ["PAYOUT_HOLD_PLACED", "PAYOUT_HOLD_RELEASED"]);
  assert.equal(events[0].actorRole, "FINANCE");
  assert.equal(events[0].targetId, id);
  assert.equal(events[0].reason, "Review required");
  assert.equal(activeHold.active, false);
  assert.equal(activeHold.manualActive, false);
  assert.equal(activeHold.releaseReason, "Review complete");
  assert.ok(activeHold.releasedAt instanceof Date);
});
test("releasing a manual hold preserves an open serious-case hold", async (t) => {
  const activeHold = { _id: id, active: true, manualActive: true, seriousCaseRefs: [{ reportModel: "MessageReport", reportId: id, category: "VIOLENCE" }], async save() { return this; } };
  t.mock.method(PayoutHold, "findOne", async () => activeHold);
  t.mock.method(AdminAuditEvent, "create", async () => ({}));
  const response = res();
  await releasePayouts(req("Finance review complete"), response, (error) => { throw error; });
  assert.equal(activeHold.active, true);
  assert.equal(activeHold.manualActive, false);
  assert.match(activeHold.releaseReason, /safety case hold remains active/);
  assert.equal(response.body.message, "Manual hold released; safety hold remains");
});
test("blank or invalid reasons never change holds", async (t) => {
  t.mock.method(PayoutHold, "create", () => assert.fail("must not create"));
  t.mock.method(PayoutHold, "findOneAndUpdate", () => assert.fail("must not release"));
  for (const handler of [holdPayouts, releasePayouts]) {
    for (const reason of [undefined, "  ", "ab", "a".repeat(501)]) {
      let error;
      await handler(req(reason), res(), (value) => { error = value; });
      assert.equal(error.statusCode, 400);
    }
  }
});
test("an active hold blocks processing and payment of existing payouts", async (t) => {
  t.mock.method(PayoutHold, "exists", async () => true);
  for (const [from, to] of [["PENDING", "PROCESSING"], ["PROCESSING", "PAID"], ["FAILED", "PROCESSING"]]) {
    t.mock.method(Payout, "findById", () => ({ lean: async () => ({ _id: id, user: id, status: from }) }));
    await assert.rejects(transitionPayout({ payoutId: id, status: to }), { statusCode: 403, code: "PAYOUT_ON_HOLD" });
  }
});
