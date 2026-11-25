import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import User from "../models/User.js";
import CreatorProfile from "../models/CreatorProfile.js";
import FanProfile from "../models/FanProfile.js";
import Publication from "../models/Publication.js";
import FeedPost from "../models/FeedPost.js";
import Story from "../models/Story.js";
import RecommendationBatch from "../models/RecommendationBatch.js";
import RecommendationExclusion from "../models/RecommendationExclusion.js";
import { previewRecommendations, setRecommendationExclusion, resetRecommendationConfig, searchRecommendationTargets } from "../controllers/adminRecommendationController.js";
import { clearRecommendationConfigCache } from "./recommendationService.js";

async function call(handler, req) {
  let data;
  let failure;
  const res = { req, status(code) { this.code = code; return this; }, json(body) { data = body.data; return this; } };
  await handler(req, res, error => { failure = error; });
  if (failure) throw failure;
  return data;
}

test("admin exclusions and real feed previews across all four surfaces", { skip: process.env.RECOMMENDATIONS_INTEGRATION !== "1", timeout: 120000 }, async () => {
  const server = await MongoMemoryServer.create({ binary: { version: "8.2.6" } });
  try {
    await mongoose.connect(server.getUri());
    const now = new Date();
    const admin = await User.create({ name: "Admin", username: "recommend.admin", email: "admin@recommend.test", password: "Password123!", role: "admin" });
    const viewer = await User.create({ name: "Viewer", username: "recommend.viewer", email: "viewer@recommend.test", password: "Password123!", role: "fan" });
    await FanProfile.create({ user: viewer._id, city: "Colombo", country: "Sri Lanka", interests: ["Travel"] });
    const creators = [];
    for (let i = 0; i < 5; i++) {
      const creator = await User.create({ name: `Author ${i}`, username: `recommend.author${i}`, email: `author${i}@recommend.test`, password: "Password123!", role: "creator", creatorApprovalStatus: "approved", avatar: "/uploads/portrait.jpg" });
      creators.push(creator);
      await CreatorProfile.create({ user: creator._id, city: "Colombo", country: "Sri Lanka", category: "Travel", profileVisibility: "public" });
      await Publication.collection.insertOne({ creator: creator._id, kind: "SEEN", title: `Seen ${i}`, category: "Travel", status: "PUBLISHED", visibility: "PUBLIC", publishedAt: now, createdAt: now, publishedSnapshot: { version: 1, frozenAt: now, metadata: { title: `Seen ${i}`, category: "Travel", visibility: "PUBLIC", pricing: { mode: "FREE" } }, chapters: [] } });
      await FeedPost.collection.insertOne({ author: creator._id, text: `Note ${i}`, postType: "Question", location: "Colombo, Sri Lanka", visibility: "public", moderationStatus: "APPROVED", status: "published", createdAt: now, publishedAt: now, expiresAt: new Date(Date.now() + 86400000), comments: [], media: [], reactions: [], shares: [], views: [], saves: [], hiddenBy: [] });
      await Story.collection.insertOne({ creator: creator._id, caption: `Story ${i}`, audience: "everyone", image: { url: "https://example.test/story.jpg" }, createdAt: now, expiresAt: new Date(Date.now() + 86400000), editorMetadata: {} });
    }
    await Publication.collection.insertOne({ creator: creators[4]._id, kind: "WORLD", title: "Fresh World", category: "Travel", status: "PUBLISHED", visibility: "PUBLIC", publishedAt: now, createdAt: now, publishedSnapshot: { version: 1, frozenAt: now, metadata: { title: "Fresh World", visibility: "PUBLIC", pricing: { mode: "FREE" } }, chapters: [] } });
    const request = { user: admin, adminRole: "MAIN_ADMIN", body: {}, query: {} };
    const preview = surface => call(previewRecommendations, { ...request, query: { userId: String(viewer._id), surface } });
    const ownerId = item => String(item.creator?.id || item.creator?._id || "");
    for (const surface of ["SEEN", "WALL", "DISCOVER", "STORIES"]) {
      const result = await preview(surface);
      assert.ok(result.items.length, `${surface} must have candidates`);
      assert.ok(result.items.every(item => ["interest", "related", "discovery"].includes(item.recommendation?.bucket)), `${surface} reasons must be present`);
      if (surface === "SEEN") assert.equal(result.items[2].kind, "WORLD");
    }
    assert.equal(await RecommendationBatch.countDocuments(), 0, "Preview cannot advance exposure history");
    const matches = await call(searchRecommendationTargets, { ...request, query: { model: "User", search: "recommend.author0" } });
    assert.equal(matches.items.length, 1);
    assert.equal(matches.items[0].id, String(creators[0]._id));
    await assert.rejects(call(setRecommendationExclusion, { ...request, body: { targetModel: "User", targetId: String(creators[0]._id), excluded: "true", reason: "Invalid state" } }), /valid item/);
    await call(setRecommendationExclusion, { ...request, body: { targetModel: "User", targetId: String(creators[0]._id), excluded: true, reason: "Exclude test author" } });
    for (const surface of ["SEEN", "WALL", "DISCOVER", "STORIES"]) assert.ok((await preview(surface)).items.every(item => ownerId(item) !== String(creators[0]._id)), surface);
    const seen = await Publication.findOne({ creator: creators[1]._id, kind: "SEEN" });
    await call(setRecommendationExclusion, { ...request, body: { targetModel: "Publication", targetId: String(seen._id), excluded: true, reason: "Exclude one Seen" } });
    assert.ok((await preview("SEEN")).items.every(item => item.id !== String(seen._id)));
    for (const [Model, targetModel, surface] of [[FeedPost, "FeedPost", "WALL"], [Story, "Story", "STORIES"]]) {
      const item = await Model.findOne({ [targetModel === "FeedPost" ? "author" : "creator"]: creators[2]._id });
      await call(setRecommendationExclusion, { ...request, body: { targetModel, targetId: String(item._id), excluded: true, reason: "Exclude individual item" } });
      const result = await preview(surface);
      assert.ok(result.items.every(row => row.id !== String(item._id) && !row.storyIds?.includes(String(item._id))));
    }
    await call(resetRecommendationConfig, request);
    assert.equal(await RecommendationExclusion.countDocuments(), 4, "Reset preserves exclusions");
    await call(setRecommendationExclusion, { ...request, body: { targetModel: "User", targetId: String(creators[0]._id), excluded: false, reason: "Restore test author" } });
    assert.ok((await preview("DISCOVER")).items.some(item => ownerId(item) === String(creators[0]._id)));
    assert.equal(await RecommendationBatch.countDocuments(), 0);
  } finally {
    clearRecommendationConfigCache();
    await mongoose.disconnect();
    await server.stop();
  }
});
