import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import User from "../models/User.js";
import ProfileMedia from "../models/ProfileMedia.js";
import { photoReactionSummary, setPhotoReaction, listPhotoReactions } from "./photoReactionService.js";

test("photo reactions merge legacy hearts and expose only public account fields", () => {
  const user = { _id: "a", name: "Anna", username: "anna", email: "private@example.com" };
  const summary = photoReactionSummary({ likedBy: [user], reactions: [{ user, emoji: "🔥" }] }, "a");
  assert.equal(summary.reactionCount, 1);
  assert.equal(summary.viewerReaction, "🔥");
  assert.deepEqual(summary.reactionBreakdown, { "🔥": 1 });
  assert.equal(summary.reactors[0].email, undefined);
});

test("photo reactions persist, replace, remove and preserve concurrent actors", { skip: process.env.PHOTO_MONGO_TEST !== "1", timeout: 180000 }, async () => {
  const server = await MongoMemoryServer.create();
  try {
    await mongoose.connect(server.getUri());
    const owner = await User.create({ name: "Photo Owner", username: "photoowner", email: "owner@example.com", password: "Password123!" });
    const second = await User.create({ name: "Photo Friend", username: "photofriend", email: "friend@example.com", password: "Password123!" });
    const media = await ProfileMedia.create({ user: owner._id, type: "image", url: "https://example.com/photo.jpg", assetId: "photo", resourceType: "image", mimeType: "image/jpeg" });
    const args = { username: owner.username, mediaId: media.id, user: owner };
    await setPhotoReaction({ ...args, reaction: "❤️" });
    assert.equal((await setPhotoReaction({ ...args, reaction: "❤️" })).reactionCount, 1);
    await Promise.all([setPhotoReaction({ ...args, reaction: "🔥" }), setPhotoReaction({ ...args, user: second, reaction: "🤝" })]);
    let result = await listPhotoReactions({ ...args, viewerId: owner.id });
    assert.equal(result.reactionCount, 2);
    assert.equal(result.viewerReaction, "🔥");
    assert.ok(result.reactors.some(row => row.name === "Photo Friend"));
    result = await setPhotoReaction({ ...args, reaction: null });
    assert.equal(result.reactionCount, 1);
    assert.equal(result.viewerReaction, null);
    await assert.rejects(setPhotoReaction({ ...args, reaction: "invalid" }));
    await assert.rejects(listPhotoReactions({ ...args, username: second.username }));
  } finally { await mongoose.disconnect(); await server.stop(); }
});
