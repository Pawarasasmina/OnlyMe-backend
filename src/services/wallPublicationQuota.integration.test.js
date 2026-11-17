import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import FeedPost from "../models/FeedPost.js";
import WallCreationLedger from "../models/WallCreationLedger.js";
import WallPublicationLog from "../models/WallPublicationLog.js";
import { createFeedPost, deleteFeedPost, archiveFeedPost } from "../controllers/postController.js";
import { reserveWallCreation } from "./wallCreationService.js";

test("deleted and archived publications retain slots, text history, and durable note IDs", { timeout: 120000 }, async () => {
  const database = await MongoMemoryServer.create();
  try {
    await mongoose.connect(database.getUri());
    await Promise.all([FeedPost.init(), WallCreationLedger.init(), WallPublicationLog.init()]);
    const now = new Date();
    const established = { _id: new mongoose.Types.ObjectId(), role: "fan", createdAt: new Date(now - 8 * 86400000) };
    const fresh = { _id: new mongoose.Types.ObjectId(), role: "fan", createdAt: now };
    const invoke = async (controller, request) => {
      let error;
      const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
      await controller(request, response, value => { error = value; });
      return { error, response };
    };
    const publish = (user, text, key) => invoke(createFeedPost, { user, body: { text, postType: "Question" }, files: {}, get: () => key });
    for (const [user, limit, prefix] of [[established, 5, "older"], [fresh, 2, "fresh"]]) {
      const published = [];
      for (let i = 0; i < limit; i++) {
        const result = await publish(user, `${prefix} question ${i}`, `${prefix}_request_${i}`);
        assert.ifError(result.error);
        published.push(result.response.body.data.post.id);
      }
      assert.ifError((await invoke(deleteFeedPost, { user, params: { id: published[0] } })).error);
      assert.ifError((await invoke(archiveFeedPost, { user, params: { id: published[1] } })).error);
      const duplicate = await publish(user, `  ${prefix.toUpperCase()} QUESTION 0!!! `, `${prefix}_duplicate`);
      assert.equal(duplicate.error?.code, "WALL_DUPLICATE_TEXT");
      assert.equal(duplicate.error?.message, "You already posted this today");
      assert.equal((await publish(user, `${prefix} corrected question`, `${prefix}_corrected`)).error?.code, "WALL_DAILY_LIMIT");
      const log = await WallPublicationLog.find({ author: user._id }).lean();
      assert.equal(log.length, limit);
      assert.deepEqual(log.map(entry => String(entry.postId)).sort(), published.sort());
      // Losing the quota cache or purging notes cannot erase durable publications.
      await FeedPost.deleteMany({ author: user._id });
      await WallCreationLedger.deleteOne({ _id: user._id });
      assert.equal((await publish(user, `${prefix} after purge`, `${prefix}_purged`)).error?.code, "WALL_DAILY_LIMIT");
    }
    const author = new mongoose.Types.ObjectId();
    await reserveWallCreation(author, "A typo", "original_typo", now, { postId: new mongoose.Types.ObjectId() });
    await reserveWallCreation(author, "A corrected typo", "corrected_typo", now);
    assert.equal(await WallPublicationLog.countDocuments({ author }), 2);
    await assert.rejects(reserveWallCreation(author, "A typo", "before_boundary", new Date(now.getTime() + 86400000 - 1)), { code: "WALL_DUPLICATE_TEXT" });
    await reserveWallCreation(author, "A typo", "at_boundary", new Date(now.getTime() + 86400000));
  } finally {
    await mongoose.disconnect();
    await database.stop();
  }
});
