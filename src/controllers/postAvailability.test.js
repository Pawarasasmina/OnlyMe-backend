import test from "node:test";
import assert from "node:assert/strict";
import FeedPost from "../models/FeedPost.js";
import SavedItem from "../models/SavedItem.js";
import { bumpFeedPost, serializePost } from "./postController.js";
import { needsAvailabilityConfirmation } from "../services/wallResolutionService.js";
import { wallFeedPipeline } from "../services/wallFeedFilterService.js";
const id = "507f1f77bcf86cd799439011";
const owner = "507f1f77bcf86cd799439012";
const other = "507f1f77bcf86cd799439013";
const day = 86400000;
const res = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
test("availability confirmation uses a 14-day interval since posting or last bump", () => {
  const now = Date.now();
  for (const postType of ["Buy & Sell", "Offering"]) {
    const post = { postType, publishedAt: new Date(now - 14 * day) };
    assert.equal(needsAvailabilityConfirmation(post, now), true);
    assert.equal(needsAvailabilityConfirmation(post, now - 1), false);
    assert.equal(needsAvailabilityConfirmation({ ...post, bumpedAt: new Date(now) }, now), false);
    assert.equal(needsAvailabilityConfirmation({ ...post, resolvedAt: new Date() }, now), false);
  }
  assert.equal(needsAvailabilityConfirmation({ context: "Buy/Sell", createdAt: new Date(now - 15 * day) }, now), true);
  assert.equal(needsAvailabilityConfirmation({ postType: "Question", createdAt: new Date(now - 15 * day) }, now), false);
});
test("confirmation is owner-only and excludes expired and sold notes", () => {
  const post = new FeedPost({ _id: id, author: owner, text: "Bicycle", postType: "Buy & Sell", status: "published", publishedAt: new Date(Date.now() - 15 * day) });
  assert.equal(serializePost(post, { _id: owner }).canBump, true);
  assert.equal(serializePost(post, { _id: other }).canBump, false);
  post.rightNow = true;
  assert.equal(serializePost(post, { _id: owner }).canBump, false);
  post.rightNow = false;
  post.resolvedAt = new Date();
  assert.equal(serializePost(post, { _id: owner }).canBump, false);
});
test("conditional bump retains publication date, content, comments and reactions", async t => {
  const publishedAt = new Date(Date.now() - 15 * day);
  const post = new FeedPost({ _id: id, author: owner, text: "Bicycle, 200 AED", postType: "Buy & Sell", status: "published", publishedAt, comments: [{ user: other, text: "Can I collect tomorrow?" }], reactions: [{ user: other, reaction: "love" }] });
  let write;
  t.mock.method(FeedPost, "findOneAndUpdate", async (filter, update, options) => { write = { filter, update, options }; post.bumpedAt = update.$set.bumpedAt; return post; });
  t.mock.method(post, "populate", async () => post);
  t.mock.method(SavedItem, "find", () => ({ select: () => ({ lean: async () => [] }) }));
  let error;
  const response = res();
  await bumpFeedPost({ params: { id }, user: { _id: owner } }, response, value => { error = value; });
  assert.ifError(error);
  assert.equal(write.filter.author, owner);
  assert.equal(write.filter.status, "published");
  assert.equal(write.filter.deletedAt, null);
  assert.equal(write.filter.$and.length, 3);
  assert.deepEqual(Object.keys(write.update.$set), ["bumpedAt"]);
  assert.equal(post.publishedAt.getTime(), publishedAt.getTime());
  assert.equal(response.body.data.post.comments.length, 1);
  assert.equal(response.body.data.post.supportCount, 1);
  assert.equal(response.body.data.post.canBump, false);
  assert.deepEqual(response.body.data.post.feedCreatedAt, post.bumpedAt);
});
test("unavailable/repeated bump fails and feed ranks original activity by bump time", async t => {
  t.mock.method(FeedPost, "findOneAndUpdate", async () => null);
  let error;
  await bumpFeedPost({ params: { id }, user: { _id: other } }, res(), value => { error = value; });
  assert.equal(error.statusCode, 409);
  const pipeline = wallFeedPipeline({}, { sort: "recent", near: "" }, [], 1, 20);
  const activity = pipeline[1].$set.__activities.$concatArrays[0][0];
  assert.deepEqual(activity.createdAt, { $ifNull: ["$bumpedAt", { $ifNull: ["$publishedAt", "$createdAt"] }] });
});
