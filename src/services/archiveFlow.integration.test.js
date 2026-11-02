import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Publication from "../models/Publication.js";
import FeedPost from "../models/FeedPost.js";
import PublicationReviewHistory from "../models/PublicationReviewHistory.js";
import { archivePublication, restorePublication } from "./publicationService.js";
import { archiveFeedPost, restoreFeedPost } from "../controllers/postController.js";

let server;
before(async () => { server = await MongoMemoryServer.create(); await mongoose.connect(server.getUri()); });
after(async () => { await mongoose.disconnect(); await server?.stop(); });

test("Seen archive/restore preserves the published snapshot and rejects stale and other-owner requests", async () => {
  const creator = new mongoose.Types.ObjectId(), id = new mongoose.Types.ObjectId();
  const publishedAt = new Date("2026-09-01");
  const snapshot = { version: 1, frozenAt: publishedAt, metadata: { title: "Published title" }, chapters: [{ stableChapterId: "first", title: "Original chapter", blocks: [] }] };
  await Publication.collection.insertOne({ _id: id, creator, kind: "SEEN", status: "PUBLISHED", statusVersion: 0, draftVersion: 1, publishedSnapshot: snapshot, publishedAt, title: "Draft title" });
  const archived = await archivePublication(creator, id, { statusVersion: 0 });
  assert.equal(archived.status, "ARCHIVED");
  await assert.rejects(restorePublication(new mongoose.Types.ObjectId(), id, { statusVersion: 1 }), /not archived/);
  await assert.rejects(restorePublication(creator, id, { statusVersion: 0 }), /changed before restoration/);
  const restored = await restorePublication(creator, id, { statusVersion: 1 });
  assert.equal(restored.status, "PUBLISHED");
  assert.equal(restored.publishedAt.toISOString(), publishedAt.toISOString());
  assert.equal(restored.publishedSnapshot.metadata.title, "Published title");
  assert.equal(restored.publishedSnapshot.chapters[0].title, "Original chapter");
  assert.equal(restored.archivedAt, undefined);
  assert.equal(await PublicationReviewHistory.countDocuments({ publication: id, action: "RESTORED" }), 1);
});

test("an archived draft restores as a draft rather than becoming publicly published", async () => {
  const creator = new mongoose.Types.ObjectId(), id = new mongoose.Types.ObjectId();
  await Publication.collection.insertOne({ _id: id, creator, kind: "SEEN", status: "DRAFT", statusVersion: 0, draftVersion: 1 });
  await archivePublication(creator, id, { statusVersion: 0 });
  assert.equal((await restorePublication(creator, id, { statusVersion: 1 })).status, "DRAFT");
});

test("Wall note restore keeps engagement and resolution intact and cannot restore another user's note", async () => {
  const user = new mongoose.Types.ObjectId(), id = new mongoose.Types.ObjectId();
  await FeedPost.collection.insertOne({ _id: id, author: user, status: "published", deletedAt: null, text: "My note", viewCount: 862, isResolved: true });
  const call = async (handler, owner) => {
    let result;
    await handler({ user: { _id: owner }, params: { id: String(id) } }, { status() { return this; }, json(data) { result = data; } }, error => { throw error; });
    return result;
  };
  await call(archiveFeedPost, user);
  await assert.rejects(call(restoreFeedPost, new mongoose.Types.ObjectId()), /not found/);
  assert.equal((await call(restoreFeedPost, user)).data.restored, true);
  const restored = await FeedPost.findById(id).lean();
  assert.equal(restored.status, "published");
  assert.equal(restored.viewCount, 862);
  assert.equal(restored.isResolved, true);
});
