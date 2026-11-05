import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import FeedPost from "../models/FeedPost.js";
import { getWallNeedCounts } from "./postController.js";
import { readWallFeedFilters } from "../services/wallFeedFilterService.js";

test("need cards show three distinct active authors, excluding expired and private notes", async () => {
  const server = await MongoMemoryServer.create();
  try {
    await mongoose.connect(server.getUri());
    const authors = Array.from({ length: 3 }, () => new mongoose.Types.ObjectId());
    await mongoose.connection.collection("users").insertMany(authors.map((_id, index) => ({ _id, name: `Author ${index}`, avatar: `https://example.test/${index}.jpg` })));
    const now = Date.now();
    const note = (author, age, extra = {}) => ({ author, postType: "Looking for", topic: "Meet people", rightNow: true, text: `Note ${age}`, status: "published", visibility: "public", publishedAt: new Date(now - age), createdAt: new Date(now - age), ...extra });
    await FeedPost.collection.insertMany([
      note(authors[0], 0), note(authors[0], 1000), note(authors[0], 2000),
      note(authors[1], 3000), note(authors[2], 4000),
      note(authors[1], 2 * 86400000), note(authors[1], 5000, { resolvedAt: new Date() }),
      note(authors[2], 6000, { visibility: "private" }),
    ]);
    const res = { status() { return this; }, json(body) { this.body = body; } };
    let error;
    await getWallNeedCounts({ user: { _id: new mongoose.Types.ObjectId() }, query: {} }, res, value => { error = value; });
    assert.ifError(error);
    for (const key of ["right_now", "meet_people"]) {
      assert.equal((key === "meet_people" ? res.body.data.topicCounts : res.body.data.counts)[key], 5);
      const previews = res.body.data.previews[key];
      assert.equal(previews.length, 3);
      assert.equal(new Set(previews.map(post => String(post.author._id))).size, 3);
      assert.equal(previews[0].text, "Note 0");
      assert.ok(previews.every(post => post.author.avatar));
    }
    await FeedPost.collection.insertMany([
      note(authors[0], 100, { postType: "Need Help", text: "Matches all three" }),
      note(authors[1], 200, { postType: "Need Help", rightNow: false }),
      note(authors[2], 300, { postType: "Need Help", topic: "Housing" }),
    ]);
    const { match } = readWallFeedFilters({ rightNow: "true", type: "need_help", topic: "meet_people" });
    const matching = await FeedPost.find({ ...match, status: "published", visibility: "public" }).lean();
    assert.deepEqual(matching.map(post => post.text), ["Matches all three"]);
  } finally {
    await mongoose.disconnect();
    await server.stop();
  }
});
