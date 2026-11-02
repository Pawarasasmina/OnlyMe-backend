import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import MembershipContentEvent from "../models/MembershipContentEvent.js";
import Story from "../models/Story.js";
import Publication from "../models/Publication.js";
import PremiumMembership from "../models/PremiumMembership.js";
import GroupConversation from "../models/GroupConversation.js";
import GroupMessage from "../models/GroupMessage.js";
import { getMembershipLibrary } from "../controllers/membershipLibraryController.js";

let server;
before(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
  await MembershipContentEvent.init();
});
after(async () => { await mongoose.disconnect(); await server?.stop(); });

test("real Library recap survives story expiry and excludes old, private, and future activity", async () => {
  const creator = new mongoose.Types.ObjectId(), user = new mongoose.Types.ObjectId(), world = new mongoose.Types.ObjectId(), membershipId = new mongoose.Types.ObjectId();
  const now = Date.now(), start = new Date(now - 86400000), recent = new Date(now - 3600000), end = new Date(now + 86400000);
  await PremiumMembership.collection.insertOne({ _id: membershipId, user, creator, premiumPublication: world, status: "ACTIVE", currentPeriodStart: start, currentPeriodEnd: end });
  const chapters = [{ stableChapterId: "new", title: "New chapter", blocks: [] }, { stableChapterId: "scheduled", title: "Future", blocks: [], releaseMode: "SCHEDULED", releaseAt: end }];
  await Publication.collection.insertOne({ _id: world, creator, status: "PUBLISHED", publishedAt: recent, publishedSnapshot: { version: 1, frozenAt: recent, metadata: {}, chapters } });
  const story = await Story.create({ creator, audience: "world", caption: "Private story", createdAt: recent, expiresAt: end });
  await Story.create({ creator, audience: "everyone", expiresAt: end });
  await MembershipContentEvent.create({ key: "old-story", creator, kind: "STORY", occurredAt: new Date(start.getTime() - 1) });
  const group = await GroupConversation.create({ name: "World circle", createdBy: creator, members: [user, creator], admins: [creator], worldPublication: world });
  const unrelated = await GroupConversation.create({ name: "Other group", createdBy: creator, members: [user, creator], admins: [creator] });
  await GroupMessage.create([
    { group: group._id, sender: creator, body: "Count me", createdAt: recent },
    { group: group._id, sender: creator, body: "Old", createdAt: new Date(start.getTime() - 1) },
    { group: group._id, sender: creator, body: "Deleted", createdAt: recent, deletedAt: recent },
    { group: group._id, sender: creator, body: "Hidden", createdAt: recent, deletedFor: [user] },
    { group: unrelated._id, sender: creator, body: "Unrelated", createdAt: recent },
  ]);
  async function request() {
    let data;
    await getMembershipLibrary({ user: { _id: user }, params: { id: String(membershipId) } }, { status() { return this; }, json(body) { data = body.data; } }, error => { throw error; });
    return data;
  }
  assert.deepEqual((await request()).recap, { stories: 1, chapters: 1, messages: 1 });
  // A story's natural expiry/removal must not erase its monthly publication count.
  await Story.deleteOne({ _id: story._id });
  assert.deepEqual((await request()).recap, { stories: 1, chapters: 1, messages: 1 });
  assert.equal(await MembershipContentEvent.countDocuments({ key: `story:${story._id}` }), 1);
  // Republishing the same chapter does not increment the count.
  await Publication.findOneAndUpdate({ _id: world }, { $set: { publishedAt: new Date() } }, { new: true });
  assert.deepEqual((await request()).recap, { stories: 1, chapters: 1, messages: 1 });
});
