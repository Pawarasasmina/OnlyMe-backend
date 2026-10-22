import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import FeedPost from "../models/FeedPost.js";
import UserBlock from "../models/UserBlock.js";
import { listFeedPosts, postControllerTestUtils } from "./postController.js";

test("Wall endpoint applies combined filters and preserves aggregate order for posts and shares", async (t) => {
  t.mock.method(postControllerTestUtils, "personalizeCandidates", async ({ items }) => ({ items, recommendation: null }));
  const viewer = new mongoose.Types.ObjectId();
  const blocked = new mongoose.Types.ObjectId();
  const author = { _id: new mongoose.Types.ObjectId(), name: "Author", username: "author" };
  const postA = { _id: new mongoose.Types.ObjectId(), author, text: "A", postType: "Looking for", topic: "Services", location: "Dubai", comments: [] };
  const postB = { ...postA, _id: new mongoose.Types.ObjectId(), text: "B" };
  const shareId = new mongoose.Types.ObjectId();
  t.mock.method(UserBlock, "find", () => ({ select: () => ({ lean: async () => [{ blocker: viewer, blocked }] }) }));
  let pipeline;
  t.mock.method(FeedPost, "aggregate", (value) => {
    pipeline = value;
    return { allowDiskUse: async () => [{ items: [
      { _id: postB._id, __activity: { shareId, createdAt: new Date(), caption: "Helpful", user: author._id }, __sharer: author },
      { _id: postA._id, __activity: { shareId: null } },
    ], total: [{ count: 5 }] }] };
  });
  t.mock.method(FeedPost, "find", () => ({ populate: () => ({ lean: async () => [postA, postB] }) }));
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  let error;
  await listFeedPosts({ user: { _id: viewer }, query: { type: "looking_for", topic: "services", sort: "popular", scope: "city", location: "Dubai", page: 2, limit: 2 } }, res, (value) => { error = value; });
  assert.ifError(error);
  assert.equal(res.code, 200);
  assert.deepEqual(pipeline[0].$match.author.$nin, [blocked]);
  assert.equal(pipeline[0].$match["hiddenBy.user"].$ne, viewer);
  assert.equal(pipeline[0].$match.$and.length, 3);
  assert.equal(pipeline.find((stage) => stage.$sort).$sort.__popularity, -1);
  assert.equal(pipeline.at(-1).$facet.items[0].$skip, 2);
  assert.equal(res.body.data.items[0].id, `share-${shareId}`);
  assert.equal(res.body.data.items[0].shareCaption, "Helpful");
  assert.equal(String(res.body.data.items[1].id), String(postA._id));
  assert.deepEqual(res.body.data.pagination, { page: 2, limit: 2, total: 5, pages: 3 });
});

for (const sort of [undefined, "recent"]) {
  test(`Wall ${sort || "default"} keeps a new post above old shares on every fetch`, async (t) => {
    t.mock.method(postControllerTestUtils, "personalizeCandidates", async () => {
      assert.fail("Recent feeds must not be reordered by recommendations");
    });
    const viewer = new mongoose.Types.ObjectId();
    const author = { _id: viewer, name: "Viewer", username: "viewer" };
    const newest = { _id: new mongoose.Types.ObjectId(), author, text: "New note", comments: [] };
    const older = { ...newest, _id: new mongoose.Types.ObjectId(), text: "Older note" };
    const shareId = new mongoose.Types.ObjectId();
    t.mock.method(UserBlock, "find", () => ({ select: () => ({ lean: async () => [] }) }));
    t.mock.method(FeedPost, "aggregate", (pipeline) => {
      assert.equal(pipeline.find((stage) => stage.$sort).$sort["__activity.createdAt"], -1);
      return { allowDiskUse: async () => [{ items: [
        { _id: newest._id, __activity: { shareId: null } },
        { _id: older._id, __activity: { shareId, createdAt: new Date("2026-10-17"), user: viewer }, __sharer: author },
      ], total: [{ count: 2 }] }] };
    });
    // Hydration order is deliberately different from the sorted activity order.
    t.mock.method(FeedPost, "find", () => ({ populate: () => ({ lean: async () => [older, newest] }) }));
    for (let fetch = 0; fetch < 2; fetch += 1) {
      const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
      let error;
      await listFeedPosts({ user: { _id: viewer }, query: { ...(sort ? { sort } : {}), page: 1, limit: 20 } }, res, (value) => { error = value; });
      assert.ifError(error);
      assert.equal(res.code, 200);
      assert.equal(String(res.body.data.items[0].id), String(newest._id));
      assert.equal(res.body.data.items[1].id, `share-${shareId}`);
      assert.equal(res.body.data.recommendation, null);
    }
  });
}
