import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import FeedPost from "../models/FeedPost.js";
import User from "../models/User.js";
import WallPublicationLog from "../models/WallPublicationLog.js";
import { updateFeedPost, serializePost } from "../controllers/postController.js";
import { canEditWallNote, WALL_EDIT_MS } from "./wallEditService.js";
test("edit boundary is exclusive and never extends after prior edits or bumps", () => {
  const now = Date.now(), post = { status: "published", publishedAt: new Date(now - WALL_EDIT_MS), bumpedAt: new Date(now), editedAt: new Date(now) };
  assert.equal(Boolean(canEditWallNote(post, now)), false);
  assert.equal(Boolean(canEditWallNote({ ...post, publishedAt: new Date(now - WALL_EDIT_MS + 1) }, now)), true);
});
test("edits preserve publication/quota and store hidden prior versions; stale and late saves fail", { skip: process.env.WALL_MONGO_INTEGRATION !== "1", timeout: 120000 }, async () => {
  const server = await MongoMemoryServer.create();
  try {
    await mongoose.connect(server.getUri());
    const user = await User.create({ name: "Editor", username: "editor", email: "editor@example.test", password: "fixture-password", createdAt: new Date(Date.now() - 8 * 86400000) });
    const publishedAt = new Date(Date.now() - 60000);
    const post = await FeedPost.create({ author: user._id, text: "Original desk", postType: "Buy & Sell", context: "Buy/Sell", price: 123, currency: "AED", location: "Dubai, UAE", publishedAt, media: [{ type: "image", url: "https://example.test/photo.jpg", assetId: "photo" }] });
    const run = async body => { let error; const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; await updateFeedPost({ user, params: { id: String(post._id) }, body, files: {} }, res, value => { error = value; }); return { error, res }; };
    let result = await run({ text: "Updated desk", price: "150", rightNow: true, retainedMedia: "[]", editVersion: 0 });
    assert.ifError(result.error); assert.equal(result.res.code, 200);
    let stored = await FeedPost.findById(post._id).select("+noteVersions");
    assert.equal(stored.text, "Updated desk"); assert.equal(stored.price, 150); assert.equal(stored.media.length, 0); assert.equal(stored.rightNow, true);
    assert.equal(stored.publishedAt.getTime(), publishedAt.getTime()); assert.equal(stored.bumpedAt, null);
    assert.ok(stored.editedAt); assert.equal(stored.noteVersions.length, 1); assert.equal(stored.noteVersions[0].text, "Original desk"); assert.equal(stored.noteVersions[0].media.length, 1);
    assert.equal(await WallPublicationLog.countDocuments({ author: user._id }), 1);
    assert.equal(serializePost(stored, user).noteVersions, undefined);
    result = await run({ text: "Stale save", editVersion: 0 }); assert.equal(result.error?.statusCode, 409);
    result = await run({ text: "WhatsApp me", editVersion: stored.__v }); assert.equal(result.error?.code, "WALL_CONTACT_DETAILS");
    await FeedPost.updateOne({ _id: post._id }, { $set: { publishedAt: new Date(Date.now() - WALL_EDIT_MS) } });
    result = await run({ text: "Too late" }); assert.equal(result.error?.code, "WALL_EDIT_EXPIRED");
    stored = await FeedPost.findById(post._id).select("+noteVersions"); assert.equal(stored.text, "Updated desk"); assert.equal(stored.noteVersions.length, 1);
  } finally { await mongoose.disconnect(); await server.stop(); }
});
