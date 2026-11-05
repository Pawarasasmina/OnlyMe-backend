import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { env } from "../config/env.js";
import "../app.js";
import User from "../models/User.js";
import FeedPost from "../models/FeedPost.js";
import SavedItem from "../models/SavedItem.js";
import ProfileMedia from "../models/ProfileMedia.js";
import Publication from "../models/Publication.js";
import PremiumMembership from "../models/PremiumMembership.js";
import WorldEntitlement from "../models/WorldEntitlement.js";
import Wallet from "../models/Wallet.js";
import Notification from "../models/Notification.js";
import DAWindow from "../models/DAWindow.js";
import Repost from "../models/Repost.js";
import { getFanActivity, fanDashboardTestUtils } from "./fanController.js";
import { processPremiumRenewalReminders } from "../services/premiumMembershipService.js";
import { notifyAddedChapters } from "../services/publicationUpdateNotificationService.js";

let server;
before(async () => { env.resendApiKey = ""; server = await MongoMemoryServer.create(); await mongoose.connect(server.getUri()); });
afterEach(async () => { for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({}); });
after(async () => { await mongoose.disconnect(); await server.stop(); });
const oid = () => new mongoose.Types.ObjectId();
async function users() {
  const [owner, first, second] = [oid(), oid(), oid()];
  await User.collection.insertMany([owner, first, second].map((_id, i) => ({ _id, email: `person-${i}@example.test`, name: ["Owner", "Lina", "Omar"][i], username: `person-${i}`, role: "fan", status: "active" })));
  return { owner, first, second };
}
async function activity(owner, filter = "all") {
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await getFanActivity({ user: { _id: owner }, query: { direction: "received", filter, limit: "100" } }, res, error => { throw error; });
  assert.equal(res.code, 200); return res.body.data.items;
}

test("real comment saves, threaded replies and photo reactions appear with exact current targets", async () => {
  const { owner, first, second } = await users();
  const parent = oid(), reply = oid(), photo = oid();
  const post = await FeedPost.create({ author: first, text: "Original note", status: "published", visibility: "public", comments: [{ _id: parent, user: owner, text: "Try the counter seats — half the wait." }, { _id: reply, parentCommentId: parent, user: second, text: "Which floor?" }] });
  await SavedItem.create([{ user: first, targetType: "comment", targetModel: "FeedPostComment", targetId: parent }, { user: second, targetType: "comment", targetModel: "FeedPostComment", targetId: parent }]);
  await ProfileMedia.collection.insertOne({ _id: photo, user: owner, type: "image", url: "https://example.test/photo.jpg", reactions: [{ user: first, emoji: "🔥", createdAt: new Date() }, { user: second, emoji: "🔥", createdAt: new Date() }] });
  const items = await activity(owner);
  const saved = items.find(row => row.type === "comment_save_group");
  assert.equal(saved.aggregate.count, 2); assert.equal(saved.title, "2 people saved your comment");
  assert.equal(saved.preview, "Try the counter seats — half the wait."); assert.equal(saved.target.preview, "Original note");
  assert.equal(saved.actionPath, `/posts/${post._id}?comment=${parent}`);
  assert.equal(items.find(row => row.type === "note_reply").actionPath, `/posts/${post._id}?comment=${reply}`);
  const reaction = items.find(row => row.type === "photo_reaction_group");
  assert.equal(reaction.aggregate.count, 2); assert.equal(reaction.target.imageUrl, "https://example.test/photo.jpg"); assert.equal(reaction.actionPath, `/profile?photo=${photo}`);
  await FeedPost.updateOne({ _id: post._id }, { $set: { "comments.$[comment].deletedAt": new Date() } }, { arrayFilters: [{ "comment._id": parent }] });
  await ProfileMedia.deleteOne({ _id: photo });
  const removed = await activity(owner);
  assert.equal(removed.some(row => ["comment_save_group", "photo_reaction_group", "note_reply"].includes(row.type)), false);
});

test("Direct Access Answer uses the right user and window and disappears after expiry", async () => {
  const { owner, first } = await users();
  const window = await DAWindow.create({ creator: owner, fan: first, priceStars: 100, settlementStatus: "HELD", status: "OPEN", openedAt: new Date(), expiresAt: new Date(Date.now() + 86400000) });
  let row = (await activity(owner)).find(item => item.type === "direct_access");
  assert.equal(row.metadata.canAnswer, true); assert.equal(row.actionPath, `/messages?tab=direct&with=${first}&window=${window._id}`);
  await DAWindow.updateOne({ _id: window._id }, { $set: { status: "EXPIRED", settlementStatus: "REFUNDED", expiresAt: new Date(Date.now() - 1) } });
  row = (await activity(owner)).find(item => item.type === "direct_access"); assert.equal(row.metadata.canAnswer, false);
  await Notification.create({ user: first, type: "direct_access_refunded", title: "Refund", dedupeKey: `da-refund:${window._id}` });
  const refund = (await activity(first)).find(item => item.type === "direct_access_refunded");
  assert.equal(refund.metadata.refundCoins, 100); assert.match(refund.title, /100 coins are back/); assert.equal(refund.actionPath, `/messages?tab=direct&with=${owner}&window=${window._id}`);
});

test("late reminders catch up, warn about low balance, deduplicate and cover every batch", async () => {
  const { owner, first, second } = await users();
  const world = oid();
  await Publication.collection.insertOne({ _id: world, creator: owner, kind: "PREMIUM_WORLD", title: "Sofia’s World", status: "PUBLISHED" });
  const now = new Date();
  await PremiumMembership.collection.insertMany(Array.from({ length: 201 }, (_, i) => ({ _id: oid(), user: i % 2 ? first : second, creator: owner, premiumPublication: world, starsPerPeriod: 290, status: "ACTIVE", cancelAtPeriodEnd: false, currentPeriodEnd: new Date(now.getTime() + 2 * 86400000) })));
  await Wallet.create({ user: first, balance: 500 });
  assert.equal((await processPremiumRenewalReminders(now)).sent, 201);
  assert.equal(await Notification.countDocuments({ type: "premium_renewal_low_balance" }), 101);
  assert.equal((await processPremiumRenewalReminders(now)).sent, 0);
  const rows = await activity(second);
  const reminder = rows.find(row => row.type === "premium_renewal_low_balance");
  assert.equal(reminder.actionPath, "/wallet"); assert.equal(reminder.target.id, String(world));
  assert.equal(await Notification.countDocuments({ user: owner }), 0);
});

test("published additional chapters notify current owners once, not first publication or removed access", async () => {
  const { owner, first, second } = await users();
  const publicationId = oid();
  await WorldEntitlement.collection.insertMany([{ user: first, publication: publicationId, creator: owner, status: "ACTIVE" }, { user: second, publication: publicationId, creator: owner, status: "REVOKED" }]);
  const previous = { publishedSnapshot: { chapters: [{ stableChapterId: "one" }] } };
  const publication = { _id: publicationId, creator: owner, kind: "SEEN", title: "My Secret Food Map", publishedVersion: 2, publishedSnapshot: { chapters: [{ stableChapterId: "one" }, { stableChapterId: "two", title: "New chapter" }] } };
  assert.equal((await notifyAddedChapters(previous, publication)).sent, 1);
  await notifyAddedChapters(previous, publication);
  assert.equal(await Notification.countDocuments({ type: "publication_chapter_added" }), 1);
  const notice = await Notification.findOne({ user: first }).lean();
  assert.match(notice.title, /added a chapter/);
  assert.equal(fanDashboardTestUtils.notificationActivity(notice).actionPath, `/seen/${publicationId}`);
  assert.equal((await notifyAddedChapters({}, publication)).sent, 0);
});

test("Seen tags notify only newly tagged people and open the current reader", async () => {
  const { owner, first } = await users();
  const publication = { _id: oid(), creator: owner, kind: "SEEN", title: "Style Foundations", publishedVersion: 1, publishedSnapshot: { metadata: { title: "Style Foundations", taggedPeople: [first, owner] }, chapters: [] } };
  await notifyAddedChapters({}, publication);
  await notifyAddedChapters({}, publication);
  assert.equal(await Notification.countDocuments({ type: "publication_tag" }), 1);
  const notice = await Notification.findOne({ user: first }).lean();
  assert.equal(fanDashboardTestUtils.notificationActivity(notice).actionPath, `/seen/${publication._id}`);
  await notifyAddedChapters(publication, { ...publication, publishedVersion: 2 });
  assert.equal(await Notification.countDocuments({ type: "publication_tag" }), 1);
});

test("real reposts appear for their author and disappear when removed", async () => {
  const { owner, first } = await users();
  const publication = oid();
  await Publication.collection.insertOne({ _id: publication, creator: owner, kind: "SEEN", title: "Morning Espresso Ritual", status: "PUBLISHED", visibility: "PUBLIC" });
  const repost = await Repost.create({ user: first, originalAuthor: owner, targetId: publication, targetModel: "Publication", kind: "seen" });
  const row = (await activity(owner)).find(item => item.type === "content_repost");
  assert.equal(row.title, "Lina reposted your Seen");
  assert.equal(row.actionPath, `/seen/${publication}`);
  await Repost.deleteOne({ _id: repost._id });
  assert.equal((await activity(owner)).some(item => item.type === "content_repost"), false);
});

test("system titles remove decoration but reaction content and subscription destinations remain", () => {
  const system = fanDashboardTestUtils.notificationActivity({ _id: oid(), type: "system", title: "✨ Settings updated", message: "" });
  assert.equal(system.title, "Settings updated");
  const world = oid();
  const cancelled = fanDashboardTestUtils.notificationActivity({ _id: oid(), type: "premium_membership_cancelled", title: "Membership cancelled", message: "Open until Nov 15", target: { id: world, type: "PREMIUM_WORLD" } });
  assert.equal(cancelled.actionPath, `/world/${world}`);
});
