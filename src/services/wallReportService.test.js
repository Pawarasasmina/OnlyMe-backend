import test from "node:test";
import assert from "node:assert/strict";
import FeedPost from "../models/FeedPost.js";
import MessageReport from "../models/MessageReport.js";
import User from "../models/User.js";
import { qualifyingWallReporter, refreshWallReportVisibility, applyWallReportOutcome } from "./wallReportService.js";
import { wallFeedPipeline } from "./wallFeedFilterService.js";
const now = Date.now();
const oldUser = { status: "active", accountType: "REAL", createdAt: new Date(now - 8 * 86400000) };
const query = value => ({ select: () => ({ lean: async () => value }) });
function setup(t, reports, users = {}, falseCounts = {}) {
  const writes = [];
  t.mock.method(MessageReport, "find", () => query(reports));
  t.mock.method(User, "findById", id => query(users[id] || oldUser));
  t.mock.method(MessageReport, "countDocuments", async filter => falseCounts[filter.reporter] || 0);
  t.mock.method(FeedPost, "updateOne", async (filter, update) => { writes.push({ filter, update }); return { modifiedCount: 1 }; });
  return writes;
}
const report = (reporter, extra = {}) => ({ _id: `${reporter}-report`, reporter, status: "RECEIVED", updatedAt: new Date(now), ...extra });

test("only established active genuine reporters qualify and repeated confirmed false reports lose weight", () => {
  assert.equal(qualifyingWallReporter(oldUser, 2, now), true);
  assert.equal(qualifyingWallReporter(oldUser, 3, now), false);
  for (const extra of [{ status: "suspended" }, { accountType: "TEST" }, { createdAt: new Date(now - 6 * 86400000) }, { createdAt: null }]) assert.equal(qualifyingWallReporter({ ...oldUser, ...extra }, 0, now), false);
  assert.equal(qualifyingWallReporter({ ...oldUser, createdAt: new Date(now - 7 * 86400000) }, 0, now), true);
});

test("third distinct qualifying report hides the note and duplicate reporters do not inflate threshold", async t => {
  const reports = [report("a"), report("a"), report("b")];
  const writes = setup(t, reports);
  assert.deepEqual(await refreshWallReportVisibility("post"), { qualifyingReportCount: 2, hidden: false });
  reports.push(report("c"));
  assert.deepEqual(await refreshWallReportVisibility("post"), { qualifyingReportCount: 3, hidden: true });
  assert.ok(writes.at(-1).update.$set.moderationHiddenAt instanceof Date);
  assert.ok(writes.at(-1).filter.$or, "reconciliation guards against stale concurrent writes");
  reports[2].status = "RESOLVED";
  assert.equal((await refreshWallReportVisibility("post")).hidden, false);
  assert.equal(writes.at(-1).update.$set.moderationHiddenAt, null);
});

test("test accounts and repeat false reporters still reach review but cannot auto-hide notes", async t => {
  setup(t, [report("a"), report("b"), report("c")], { b: { ...oldUser, accountType: "TEST" } }, { c: 3 });
  assert.deepEqual(await refreshWallReportVisibility("post"), { qualifyingReportCount: 1, hidden: false });
});

test("duplicate review approval restores visibility once and rejection marks held content rejected", async t => {
  const writes = setup(t, []);
  await applyWallReportOutcome({ scope: "FEED_POST", feedPost: "post", source: "AUTOMATED_DUPLICATE", status: "RESOLVED", resolution: { action: "NO_ACTION" }, snapshot: { previousVisibility: "public" } });
  const approval = writes.find(write => write.update.$set.moderationStatus);
  assert.equal(approval.filter.moderationStatus, "PENDING_REVIEW");
  assert.equal(approval.update.$set.moderationStatus, "APPROVED");
  assert.equal(approval.update.$set.visibility, "public");
  await applyWallReportOutcome({ scope: "FEED_POST", feedPost: "post", source: "AUTOMATED_DUPLICATE", status: "RESOLVED", resolution: { action: "HIDDEN", note: "Confirmed copy" } });
  assert.equal(writes.findLast(write => write.update.$set.moderationStatus).update.$set.moderationStatus, "REJECTED");
});

test("discovery ranking applies report/photo trust penalties while explicit Recent remains chronological", () => {
  for (const sort of ["recent", "popular", "nearby"]) {
    const pipeline = wallFeedPipeline({}, { sort, near: "Dubai" }, [], 1, 20);
    assert.equal(pipeline[0].$match.moderationHiddenAt, null);
    assert.deepEqual(pipeline[0].$match.moderationStatus.$nin, ["PENDING_REVIEW", "REJECTED"]);
    assert.equal(pipeline.find(stage => stage.$sort).$sort.__trustPenalty, sort === "recent" ? undefined : 1);
    assert.ok(pipeline.find(stage => stage.$set?.__trustPenalty));
    assert.ok(pipeline.find(stage => stage.$lookup?.from === "messagereports"));
  }
});
