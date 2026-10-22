import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import FeedPost from "../models/FeedPost.js";
import UserBlock from "../models/UserBlock.js";
import { getWallNeedCounts } from "./postController.js";

function response() {
  return { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}

test("need counts enforce visibility, location, unresolved state, blocks and hidden notes without counting shares", async (t) => {
  const viewer = new mongoose.Types.ObjectId();
  const blocked = new mongoose.Types.ObjectId();
  t.mock.method(UserBlock, "find", () => ({ select: () => ({ lean: async () => [{ blocker: viewer, blocked }] }) }));
  let pipeline;
  t.mock.method(FeedPost, "aggregate", async (stages) => {
    pipeline = stages;
    return [{ need_help: [{ count: 3 }], buy_sell: [{ count: 2 }], topic_housing: [{ count: 4 }] }];
  });
  const res = response();
  let error;
  await getWallNeedCounts({ user: { _id: viewer }, query: { scope: "custom", location: "Dubai" } }, res, (value) => { error = value; });
  assert.ifError(error);
  assert.equal(res.code, 200);
  const match = pipeline[0].$match;
  assert.equal(match.visibility, "public");
  assert.equal(match.status, "published");
  assert.equal(match.resolvedAt, null);
  assert.equal(match.deletedAt, null);
  assert.deepEqual(match.author.$nin, [blocked]);
  assert.equal(match["hiddenBy.user"].$ne, viewer);
  assert.equal(match.$and[0].location.$regex, "Dubai");
  assert.equal(pipeline.length, 2);
  const facets = pipeline[1].$facet;
  assert.equal(Object.keys(facets).length, 34);
  assert.equal(facets.preview_need_help[1].$sort.publishedAt, -1);
  assert.equal(facets.preview_need_help[2].$limit, 3);
  assert.deepEqual(Object.keys(facets.preview_need_help.at(-1).$project), ["text", "author._id", "author.name", "author.avatar"]);
  assert.deepEqual(res.body.data.previews.right_now, []);
  assert.equal(Object.keys(res.body.data.topicCounts).length, 9);
  assert.equal(res.body.data.topicCounts.housing, 4);
  assert.equal(res.body.data.topicCounts.meet_people, 0);
  assert.equal(facets.topic_housing[0].$match.$and[0].$or[0].topic, "Housing");
  assert.ok(facets.offering[0].$match.$and[1].$nor);
  assert.ok(facets.buy_sell[0].$match.$and);
  assert.deepEqual(res.body.data.counts, { need_help: 3, looking_for: 0, offering: 0, buy_sell: 2, question: 0, recommendation: 0, event: 0, right_now: 0 });
});

test("need counts reject missing area before querying the database", async () => {
  let error;
  await getWallNeedCounts({ user: { _id: new mongoose.Types.ObjectId() }, query: { scope: "custom" } }, response(), (value) => { error = value; });
  assert.equal(error.statusCode, 400);
});

test("empty areas return zero counts including Right now", async (t) => {
  t.mock.method(UserBlock, "find", () => ({ select: () => ({ lean: async () => [] }) }));
  t.mock.method(FeedPost, "aggregate", async () => []);
  const res = response();
  let error;
  await getWallNeedCounts({ user: { _id: new mongoose.Types.ObjectId() }, query: {} }, res, (value) => { error = value; });
  assert.ifError(error);
  assert.equal(Object.keys(res.body.data.counts).length, 8);
  assert.ok(Object.values(res.body.data.counts).every((count) => count === 0));
  assert.equal(res.body.data.location, "");
});
