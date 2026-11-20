import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Publication from "../models/Publication.js";
import SeenEngagement from "../models/SeenEngagement.js";
import MessageReport from "../models/MessageReport.js";
import { removeSeenComment, reportSeenComment } from "./seenEngagementController.js";

const id = () => new mongoose.Types.ObjectId();
function query(value) {
  const row = { lean: async () => value };
  for (const method of ["select", "sort", "populate", "limit"]) row[method] = () => row;
  return row;
}
async function call(handler, req) {
  let error;
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler(req, res, value => { error = value; });
  return { res, error };
}
function fixture(t) {
  const author = id(), creator = id(), moderator = id(), stranger = id();
  const publication = { _id: id(), creator, kind: "WORLD", worldModerators: [{ user: moderator }] };
  const comment = { _id: id(), publication: publication._id, user: author, text: "Test comment" };
  t.mock.method(Publication, "findOne", () => query(publication));
  t.mock.method(Publication, "findById", () => query(publication));
  t.mock.method(SeenEngagement, "findOne", () => query(comment));
  t.mock.method(SeenEngagement, "find", () => query([]));
  t.mock.method(SeenEngagement, "aggregate", async () => []);
  const deletion = t.mock.method(SeenEngagement, "deleteMany", async () => ({ deletedCount: 1 }));
  const req = user => ({ params: { id: String(publication._id), commentId: String(comment._id) }, user: { _id: user }, body: {}, query: {} });
  return { author, creator, moderator, stranger, publication, comment, deletion, req };
}
for (const role of ["author", "creator", "moderator"]) {
  test(`${role} can delete a Seen comment`, async t => {
    const f = fixture(t);
    const { res, error } = await call(removeSeenComment, f.req(f[role]));
    assert.ifError(error);
    assert.equal(res.code, 200);
    assert.equal(res.body.data.engagement.commentCount, 0);
    assert.equal(f.deletion.mock.callCount(), 1);
  });
}
test("another fan cannot delete a Seen comment", async t => {
  const f = fixture(t);
  const { error } = await call(removeSeenComment, f.req(f.stranger));
  assert.equal(error.statusCode, 403);
  assert.equal(f.deletion.mock.callCount(), 0);
});
test("deleting a thread removes replies and their reactions within that publication", async t => {
  const f = fixture(t), reply = id();
  t.mock.method(SeenEngagement, "find", filter => query(filter.parentComment ? [{ _id: reply }] : []));
  const { error } = await call(removeSeenComment, f.req(f.author));
  assert.ifError(error);
  const filter = f.deletion.mock.calls[0].arguments[0];
  assert.equal(filter.publication, f.publication._id);
  assert.deepEqual(filter.$or[0]._id.$in, [f.comment._id, reply]);
  assert.deepEqual(filter.$or[1].parentComment.$in, [f.comment._id, reply]);
});
test("report records the comment author and snapshot in the moderation queue", async t => {
  const f = fixture(t);
  const create = t.mock.method(MessageReport, "create", async () => ({ _id: id() }));
  const req = f.req(f.stranger); req.body.reason = "SPAM";
  const { res, error } = await call(reportSeenComment, req);
  assert.ifError(error); assert.equal(res.code, 201);
  const report = create.mock.calls[0].arguments[0];
  assert.equal(report.scope, "COMMENT");
  assert.equal(report.reportedUser, f.author);
  assert.equal(report.publication, f.publication._id);
  assert.equal(report.commentId, f.comment._id);
  assert.equal(report.snapshot.text, "Test comment");
});
test("own reports and invalid report reasons are rejected", async t => {
  const f = fixture(t);
  const create = t.mock.method(MessageReport, "create", async () => ({}));
  assert.equal((await call(reportSeenComment, f.req(f.author))).error.statusCode, 400);
  const req = f.req(f.stranger); req.body.reason = "INVALID";
  assert.equal((await call(reportSeenComment, req)).error.statusCode, 400);
  assert.equal(create.mock.callCount(), 0);
});
test("duplicate reports return 409", async t => {
  const f = fixture(t);
  t.mock.method(MessageReport, "create", async () => { throw Object.assign(new Error(), { code: 11000 }); });
  assert.equal((await call(reportSeenComment, f.req(f.stranger))).error.statusCode, 409);
});
test("missing comments and invalid IDs are rejected", async t => {
  const f = fixture(t);
  t.mock.method(SeenEngagement, "findOne", () => query(null));
  for (const handler of [removeSeenComment, reportSeenComment]) {
    assert.equal((await call(handler, f.req(f.author))).error.statusCode, 404);
    const req = f.req(f.author); req.params.commentId = "bad";
    assert.equal((await call(handler, req)).error.statusCode, 400);
  }
});

test("urgent comment reports remove only the comment thread, never the publication", async t => {
  const f = fixture(t);
  const archive = t.mock.method(Publication, "updateOne", async () => ({}));
  t.mock.method(MessageReport, "updateOne", async () => ({}));
  const report = new MessageReport({ reporter: f.stranger, reportedUser: f.author, scope: "COMMENT", publication: f.publication._id, commentId: f.comment._id, reason: "CHILD_SAFETY", snapshot: {} });
  report.$locals.wasNew = true;
  report.$locals.autoHide = true;
  await new Promise((resolve, reject) => MessageReport.schema.s.hooks.execPost("save", report, [report], error => error ? reject(error) : resolve()));
  assert.equal(archive.mock.callCount(), 0);
  assert.equal(f.deletion.mock.callCount(), 1);
});
test("reports require an accessible publication", async t => {
  const f = fixture(t);
  t.mock.method(Publication, "findOne", () => query(null));
  const create = t.mock.method(MessageReport, "create", async () => ({}));
  assert.equal((await call(reportSeenComment, f.req(f.stranger))).error.statusCode, 404);
  assert.equal(create.mock.callCount(), 0);
});
