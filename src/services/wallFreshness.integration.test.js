import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import FeedPost from "../models/FeedPost.js";
import User from "../models/User.js";
import { flagRecommendationOutdated } from "../controllers/wallFreshnessController.js";
import { bumpFeedPost, serializePost } from "../controllers/postController.js";
import { wallFeedPipeline } from "./wallFeedFilterService.js";
import { validateWallCreation, assertNotExactWallCopy } from "./wallCreationService.js";
import { hasWallContacts } from "./wallPublishingPolicy.js";
const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test("publishing messages and contact threshold match the specification", () => {
  assert.equal(hasWallContacts("Call 12345678"), true);
  assert.equal(hasWallContacts("1234567"), false);
  assert.equal(hasWallContacts("Find me on Signal"), true);
  for (const [text, message] of [["12345678", "Keep numbers and messengers out — people can message you right from the note"], ["example.com", "Links open after your first week"]]) {
    assert.throws(() => validateWallCreation({ postType: "Question", text }, {}, { createdAt: new Date() }), error => error.message === message);
  }
  assert.throws(() => assertNotExactWallCopy({ similarity: 1 }), error => error.message === "This text is already on the Wall — say it in your own words");
  assert.doesNotThrow(() => assertNotExactWallCopy({ similarity: 0.9 }));
});
test("three distinct readers prompt author and downrank; confirmation resets feedback and cooldown/cap are exact", { skip: process.env.WALL_MONGO_INTEGRATION !== "1", timeout: 120000 }, async () => {
  const server = await MongoMemoryServer.create();
  try {
    await mongoose.connect(server.getUri());
    const owner = await User.create({ name: "Owner", username: "owner", email: "owner@example.test", password: "fixture-password" });
    const post = await FeedPost.create({ author: owner._id, postType: "Recommendation", text: "A recommendation worth checking", publishedAt: new Date() });
    const voters = Array.from({ length: 3 }, () => ({ _id: new mongoose.Types.ObjectId(), status: "active", accountType: "SEED" }));
    const vote = async user => { let error; const res = response(); await flagRecommendationOutdated({ params: { id: String(post._id) }, user }, res, value => { error = value; }); assert.ifError(error); return res; };
    await Promise.all([vote(voters[0]), vote(voters[0]), vote(voters[1])]);
    let stored = await FeedPost.findById(post._id);
    assert.equal(stored.outdatedVoters.length, 2); assert.equal(serializePost(stored, owner).needsExpiryPrompt, false);
    await vote(voters[2]); stored = await FeedPost.findById(post._id);
    assert.equal(stored.outdatedVoters.length, 3); assert.equal(serializePost(stored, owner).needsExpiryPrompt, true); assert.equal(serializePost(stored, owner).canBump, true);
    const [row] = await FeedPost.aggregate(wallFeedPipeline({ _id: post._id }, { sort: "popular", near: "" }, [], 1, 20));
    assert.ok(row.items[0].__trustPenalty >= 2);
    const bump = async () => { let error; const res = response(); await bumpFeedPost({ params: { id: String(post._id) }, user: owner }, res, value => { error = value; }); return { error, res }; };
    let result = await bump(); assert.ifError(result.error);
    stored = await FeedPost.findById(post._id); assert.equal(stored.outdatedVoters.length, 0); assert.equal(serializePost(stored, owner).needsExpiryPrompt, false);
    result = await bump(); assert.equal(result.error.message, "You can bump again in 7 days");
    await FeedPost.updateOne({ _id: post._id }, { $set: { bumpCount: 3 } });
    result = await bump(); assert.equal(result.error.message, "Bumped 3 times — post it fresh if it's still on");
  } finally { await mongoose.disconnect(); await server.stop(); }
});
