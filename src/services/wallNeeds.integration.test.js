import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import User from "../models/User.js";
import FeedPost from "../models/FeedPost.js";
import { readWallFeedFilters } from "./wallFeedFilterService.js";
import { getWallHintDismissals, dismissWallHint } from "./wallNeedHintService.js";
import { getWallView, setWallView } from "./wallViewPreferenceService.js";
import { readWallPrice } from "./wallPriceService.js";
import { serializePost } from "../controllers/postController.js";

test("MongoDB returns the union of icon choices and persists hints separately per account", { timeout: 60000 }, async () => {
  const server = await MongoMemoryServer.create();
  try {
    await mongoose.connect(server.getUri());
    const first = new mongoose.Types.ObjectId(), second = new mongoose.Types.ObjectId();
    await User.collection.insertMany([{ _id: first, name: "First" }, { _id: second, name: "Second" }]);
    const now = new Date();
    const note = (text, postType, topic, extra = {}) => ({ author: first, text, postType, topic, publishedAt: now, createdAt: now, ...extra });
    await FeedPost.collection.insertMany([
      note("help", "Need Help", "Work"),
      note("company", "Offering", "Meet people"),
      note("live", "Question", "Food", { rightNow: true }),
      note("sale", "Buy & Sell", "Food"),
      note("other", "Recommendation", "Places"),
      note("expired-live", "Question", "Food", { rightNow: true, publishedAt: new Date(Date.now() - 2 * 86400000), createdAt: new Date(Date.now() - 2 * 86400000) }),
    ]);
    const { match } = readWallFeedFilters({ type: "need_help,buy_sell", topic: "meet_people", rightNow: "true", matchMode: "any" });
    const rows = await FeedPost.find(match).select("text").lean();
    assert.deepEqual(rows.map(row => row.text).sort(), ["company", "help", "live", "sale"]);
    await dismissWallHint(first, "need_help");
    await dismissWallHint(first, "need_help");
    assert.deepEqual(await getWallHintDismissals(first), ["need_help"]);
    assert.deepEqual(await getWallHintDismissals(second), []);
    assert.equal(await getWallView(first), "feed");
    await setWallView(first, "grid");
    assert.equal(await getWallView(first), "grid");
    assert.equal(await getWallView(second), "feed");
    const listing = await FeedPost.create({ author: first, text: "Desk", postType: "Buy & Sell", location: "Dubai, UAE", ...readWallPrice("1500", "Buy & Sell", "Dubai, UAE") });
    const stored = await FeedPost.findById(listing._id).lean();
    const serialized = serializePost({ ...stored, author: { _id: first, name: "First" } }, { _id: first });
    assert.equal(serialized.price, 1500);
    assert.equal(serialized.currency, "AED");
  } finally {
    await mongoose.disconnect();
    await server.stop();
  }
});
