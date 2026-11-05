import test from "node:test";
import assert from "node:assert/strict";
import FeedPost from "../models/FeedPost.js";
import SavedItem from "../models/SavedItem.js";
import Repost from "../models/Repost.js";
import { togglePostShare } from "./postController.js";
import { syncRepost } from "../services/repostService.js";
const id = "507f1f77bcf86cd799439011";
const owner = "507f1f77bcf86cd799439012";
test("owner can add and remove their own Wall note from profile reposts", async t => {
  const post = new FeedPost({ _id: id, author: owner, text: "A real note", status: "published", postType: "Buy & Sell", comments: [{ user: owner, text: "Pickup today" }] });
  t.mock.method(FeedPost, "findOne", async () => post);
  t.mock.method(post, "populate", async () => post);
  t.mock.method(post, "save", async () => post);
  t.mock.method(SavedItem, "find", () => ({ select: () => ({ lean: async () => [] }) }));
  const upsert = t.mock.method(Repost, "findOneAndUpdate", async () => ({}));
  const remove = t.mock.method(Repost, "deleteOne", async () => ({}));
  for (const enabled of [true, false]) {
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    let error;
    await togglePostShare({ params: { id }, user: { _id: owner, accountType: "REAL" }, get: () => "", headers: {}, body: {} }, res, value => { error = value; });
    assert.ifError(error);
    assert.equal(res.body.data.post.viewerShared, enabled);
    assert.equal(post.shares.length, enabled ? 1 : 0);
    assert.equal(post.comments.length, 1);
  }
  assert.equal(upsert.mock.callCount(), 1);
  assert.equal(remove.mock.callCount(), 1);
});
test("self repost exception is restricted to explicitly allowed Wall notes", async t => {
  const upsert = t.mock.method(Repost, "findOneAndUpdate", async () => ({}));
  await syncRepost({ enabled: true, kind: "note", originalAuthor: owner, user: owner, targetId: id, targetModel: "FeedPost" });
  await syncRepost({ allowOwn: true, enabled: true, kind: "photo", originalAuthor: owner, user: owner, targetId: id, targetModel: "ProfileMedia" });
  assert.equal(upsert.mock.callCount(), 0);
});
