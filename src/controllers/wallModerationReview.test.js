import test from "node:test";
import assert from "node:assert/strict";
import MessageReport from "../models/MessageReport.js";
import FeedPost from "../models/FeedPost.js";
import { resolveMessageReport } from "./adminController.js";
const id = "507f1f77bcf86cd799439011";
function fixture(t, extra = {}) {
  const report = { _id: id, reporter: id, reportedUser: id, feedPost: id, scope: "FEED_POST", source: "USER_REPORT", status: "RECEIVED", resolution: {}, save: async () => {}, populate: async () => {}, ...extra };
  t.mock.method(MessageReport, "findById", async () => report);
  const req = { params: { reportId: id }, user: { _id: id }, body: { action: "NO_ACTION", note: "Reviewed evidence", falseReport: true }, reportScopes: ["FEED_POST"], app: { get: () => null } };
  const res = { status() { return this; }, json(value) { this.body = value; return this; } };
  return { report, req, res };
}
test("moderator false-report finding is explicit and persisted separately from no-action", async t => {
  const { report, req, res } = fixture(t);
  let error;
  await resolveMessageReport(req, res, value => { error = value; });
  assert.equal(error, undefined);
  assert.equal(report.resolution.falseReport, true);
  assert.equal(report.status, "RESOLVED");
});
test("copy detection and enforcement actions cannot count as false user reports", async t => {
  const { req, res } = fixture(t, { source: "AUTOMATED_DUPLICATE" });
  let error;
  await resolveMessageReport(req, res, value => { error = value; });
  assert.equal(error.statusCode, 400);
});
test("ordinary no-action does not punish the reporter and closed decisions cannot repeat", async t => {
  const { report, req, res } = fixture(t);
  req.body.falseReport = false;
  await resolveMessageReport(req, res, error => { throw error; });
  assert.equal(report.resolution.falseReport, false);
  let error;
  await resolveMessageReport(req, res, value => { error = value; });
  assert.equal(error.statusCode, 409);
});
test("legacy moderator endpoint can hide and remove Wall posts", async t => {
  const { req, res } = fixture(t);
  const updates = [];
  t.mock.method(FeedPost, "updateOne", async (filter, update) => { updates.push({ filter, update }); });
  req.body = { action: "HIDDEN", note: "Confirmed spam" };
  await resolveMessageReport(req, res, error => { throw error; });
  assert.equal(updates[0].update.$set.status, "archived");
});
