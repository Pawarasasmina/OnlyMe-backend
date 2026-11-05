import test from "node:test";
import assert from "node:assert/strict";
import FeedPost from "../models/FeedPost.js";
import SavedItem from "../models/SavedItem.js";
import { createPostComment, serializePost, updatePostCommentReaction } from "./postController.js";

const id = "507f1f77bcf86cd799439011";
const viewer = "507f1f77bcf86cd799439012";
const owner = "507f1f77bcf86cd799439013";
const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const note = () => new FeedPost({ _id: id, author: owner, status: "published", postType: "Question", text: "Question", comments: [{ user: owner, text: "A comment" }] });

test("reply parent and per-viewer reaction survive serialization", () => {
  const post = note();
  const parent = post.comments[0]._id;
  post.comments.push({ user: viewer, text: "A real reply", parentCommentId: parent, reactions: [{ user: owner, reaction: "love" }] });
  const saved = serializePost(post, { _id: owner });
  assert.equal(saved.comments[1].parentCommentId, String(parent));
  assert.equal(saved.comments[1].reactionCount, 1);
  assert.equal(saved.comments[1].viewerReaction, "love");
  assert.equal(serializePost(post, { _id: viewer }).comments[1].viewerReaction, null);
});

test("reply to a missing or deleted comment fails before saving", async t => {
  const post = note();
  t.mock.method(FeedPost, "findOne", async () => post);
  t.mock.method(post, "save", () => { throw new Error("Unexpected save"); });
  for (const parentCommentId of ["invalid", viewer]) {
    let error;
    await createPostComment({ params: { id }, body: { text: "Reply", parentCommentId }, user: { _id: viewer } }, response(), value => { error = value; });
    assert.equal(error.statusCode, 400);
  }
  post.comments[0].deletedAt = new Date();
  let error;
  await createPostComment({ params: { id }, body: { text: "Reply", parentCommentId: String(post.comments[0]._id) }, user: { _id: viewer } }, response(), value => { error = value; });
  assert.equal(error.statusCode, 400);
});

test("reply reactions replace a viewer's selection and removal is idempotent", async t => {
  const post = note();
  t.mock.method(FeedPost, "findOne", async () => post);
  t.mock.method(post, "save", async () => post);
  t.mock.method(post, "populate", async () => post);
  t.mock.method(SavedItem, "find", () => ({ select: () => ({ lean: async () => [] }) }));
  for (const reaction of ["love", "love", "fire", "", ""]) {
    let error;
    const res = response();
    await updatePostCommentReaction({ params: { id, commentId: String(post.comments[0]._id) }, body: { reaction }, user: { _id: viewer, accountType: "REAL" } }, res, value => { error = value; });
    assert.ifError(error);
    assert.equal(res.code, 200);
    assert.equal(post.comments[0].reactions.length, reaction ? 1 : 0);
    assert.equal(res.body.data.post.comments[0].viewerReaction, reaction || null);
  }
});

test("resolved and expired notes still accept replies to existing comments", async t => {
  let current;
  t.mock.method(FeedPost, "findOne", async () => current);
  t.mock.method(SavedItem, "find", () => ({ select: () => ({ lean: async () => [] }) }));
  for (const state of ["sold", "resolved", "expired"]) {
    current = note();
    current.postType = state === "sold" ? "Buy & Sell" : "Question";
    current.resolvedAt = state === "expired" ? null : new Date();
    current.rightNow = state === "expired";
    current.publishedAt = new Date(Date.now() - 3 * 86400000);
    const parentCommentId = String(current.comments[0]._id);
    t.mock.method(current, "save", async () => current);
    t.mock.method(current, "populate", async () => current);
    const result = response();
    let error;
    await createPostComment({ params: { id }, body: { text: "A follow-up reply", parentCommentId }, user: { _id: viewer, accountType: "REAL" }, get: () => "", headers: {} }, result, value => { error = value; });
    assert.ifError(error);
    assert.equal(result.code, 201);
    assert.equal(result.body.data.post.comments[1].parentCommentId, parentCommentId);
    assert.equal(result.body.data.post.comments[1].text, "A follow-up reply");
    assert.equal(result.body.data.post.isClosed, true);
  }
});
