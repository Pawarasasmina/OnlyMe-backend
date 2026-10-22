import test from "node:test";
import assert from "node:assert/strict";
import FeedPost from "../models/FeedPost.js";
import SavedItem from "../models/SavedItem.js";
import { serializePost, setPostResolution } from "./postController.js";
import { isRequestWallPost } from "../services/wallResolutionService.js";
const id = "507f1f77bcf86cd799439011";
const owner = "507f1f77bcf86cd799439012";
const other = "507f1f77bcf86cd799439013";
const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test("Wall types are eligible, with legacy compatibility", () => {
  for (const postType of ["Looking for", "Offering", "Need Help", "Question", "Recommendation", "Buy & Sell", "Event", "Right Now"]) assert.equal(isRequestWallPost({ postType }), true);
  for (const context of ["Looking for", "Buy/Sell", "Need help", "Advice", "Recommendation", "Shopping"]) assert.equal(isRequestWallPost({ context }), true);
  assert.equal(isRequestWallPost({ postType: "Event", context: "Need help" }), true);
  assert.equal(isRequestWallPost({ postType: "Right Now", topic: "Buy / Sell" }), true);
  assert.equal(isRequestWallPost({ context: "Coffee" }), false);
});

test("only published request authors receive resolution controls", () => {
  const post = new FeedPost({ author: owner, text: "Need a plumber", context: "Need help", status: "published" });
  assert.equal(post.resolvedAt, null);
  assert.equal(serializePost(post, { _id: owner }).canResolve, true);
  assert.equal(serializePost(post, { _id: other }).canResolve, false);
  assert.equal(serializePost(post).canResolve, false);
  post.status = "archived";
  assert.equal(serializePost(post, { _id: owner }).canResolve, false);
  post.status = "published";
  post.postType = "Event";
  assert.equal(serializePost(post, { _id: owner }).canResolve, true);
  post.resolvedAt = new Date();
  assert.equal(serializePost(post, { _id: owner }).canResolve, true);
});

test("invalid IDs and nonboolean values are rejected before writing", async (t) => {
  const write = t.mock.method(FeedPost, "findOneAndUpdate", () => { throw new Error("Unexpected write"); });
  for (const [postId, body] of [["bad", { solved: true }], [id, {}], [id, { solved: "true" }], [id, { solved: 1 }], [id, { solved: null }]]) {
    let error;
    await setPostResolution({ params: { id: postId }, user: { _id: owner }, body }, response(), (value) => { error = value; });
    assert.equal(error.statusCode, 400);
  }
  assert.equal(write.mock.callCount(), 0);
});

test("atomic updates require ownership, publication, and request eligibility", async (t) => {
  let filter;
  t.mock.method(FeedPost, "findOneAndUpdate", async (value) => { filter = value; return null; });
  let error;
  await setPostResolution({ params: { id }, user: { _id: other }, body: { solved: true } }, response(), (value) => { error = value; });
  assert.equal(error.statusCode, 404);
  assert.equal(filter.author, other);
  assert.equal(filter.status, "published");
  assert.equal(filter.deletedAt, null);
  assert.equal(filter._id, id);
  assert.ok(filter.$or[0].postType.$in.includes("Need Help"));
  assert.deepEqual(filter.$or[2], { resolvedAt: { $type: "date" } });
});

test("solve and reopen retain replies, voice metadata, shares, and published state", async (t) => {
  const post = new FeedPost({ _id: id, author: owner, text: "Please help", postType: "Need Help", context: "Need help", status: "published", comments: [{ user: other, text: "Try this" }], media: [{ type: "audio", url: "https://example.com/voice.webm", duration: 12, transcript: "Please help", waveform: [0.2] }], shares: [{ user: other }] });
  t.mock.method(post, "populate", async () => post);
  t.mock.method(SavedItem, "find", () => ({ select: () => ({ lean: async () => [] }) }));
  const writes = [];
  t.mock.method(FeedPost, "findOneAndUpdate", async (filter, update, options) => {
    writes.push({ filter, update, options });
    post.resolvedAt = update.$set.resolvedAt;
    return post;
  });
  for (const solved of [true, true, false, false]) {
    let error;
    const res = response();
    await setPostResolution({ params: { id }, user: { _id: owner }, body: { solved } }, res, (value) => { error = value; });
    assert.ifError(error);
    assert.equal(res.code, 200);
    const saved = res.body.data.post;
    assert.equal(Boolean(saved.resolvedAt), solved);
    assert.equal(saved.status, "published");
    assert.equal(saved.text, "Please help");
    assert.equal(saved.comments.length, 1);
    assert.equal(saved.media[0].transcript, "Please help");
    assert.equal(saved.shareCount, 1);
    assert.deepEqual(Object.keys(writes.at(-1).update.$set), ["resolvedAt"]);
    assert.deepEqual(writes.at(-1).options, { new: true, runValidators: true });
  }
});
