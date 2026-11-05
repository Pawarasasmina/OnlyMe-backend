import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";
import Story from "../models/Story.js";
import Message from "../models/Message.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import UserBlock from "../models/UserBlock.js";
import ProfileRelationship from "../models/ProfileRelationship.js";
import PremiumMembership from "../models/PremiumMembership.js";
import WorldEntitlement from "../models/WorldEntitlement.js";
import Publication from "../models/Publication.js";
import FanProfile from "../models/FanProfile.js";
import { createStory, getStory, reactStory, replyStory } from "../controllers/storyController.js";
import { storyAudiencesFor, storyAudiencesByCreator } from "./storyAudienceService.js";
import { upsertStoryReactionMessage } from "./storyReactionMessageService.js";
import { resolveStorySources } from "./storySourceService.js";
import { getFanActivity, acknowledgeFanActivity } from "../controllers/fanController.js";
import { listMessages } from "../controllers/messageController.js";
import Conversation from "../models/Conversation.js";

let server;
const originalUpload = cloudinary.uploader.upload;
const originalDestroy = cloudinary.uploader.destroy;
before(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
  await Promise.all([Story.init(), Message.init(), Notification.init(), User.init()]);
  env.cloudinaryCloudName ||= "story-test";
  env.cloudinaryApiKey ||= "story-test";
  env.cloudinaryApiSecret ||= "story-test";
  cloudinary.config({ cloud_name: "story-test", api_key: "story-test", api_secret: "story-test", secure: true });
  cloudinary.uploader.upload = async (_path, options) => ({ public_id: `story-test/${new mongoose.Types.ObjectId()}`, secure_url: `https://example.test/${options.type || "upload"}/story.jpg`, resource_type: "image" });
  cloudinary.uploader.destroy = async () => ({ result: "ok" });
});
after(async () => {
  cloudinary.uploader.upload = originalUpload;
  cloudinary.uploader.destroy = originalDestroy;
  await mongoose.disconnect();
  await server?.stop();
});

async function person(name) {
  const _id = new mongoose.Types.ObjectId();
  const user = { _id, name, username: `${name.toLowerCase()}_${_id}`, email: `${_id}@example.test`, role: "fan", status: "active", accountType: "REAL" };
  await User.collection.insertOne(user);
  return user;
}
async function invoke(controller, user, { id, body = {}, file, query = {} } = {}) {
  let result; let failure;
  const events = [];
  const io = { to: (room) => ({ emit: (event, payload) => events.push({ room, event, payload }) }) };
  const req = { user, params: { id, activityId: id, userId: id }, body, file, query, app: { get: () => io } };
  const res = { status(code) { this.code = code; return this; }, json(payload) { result = payload; return payload; } };
  await controller(req, res, (error) => { failure = error; });
  if (failure) throw failure;
  return { ...result, events };
}
const mediaFile = () => ({ path: "story-test-no-file", mimetype: "image/jpeg" });
async function publish(user, body = {}) { return (await invoke(createStory, user, { body: { publishKey: String(new mongoose.Types.ObjectId()), ...body }, file: mediaFile() })).data.story; }

test("batched story permissions match individual checks for privacy, blocks and membership", async () => {
  const viewer = await person("BatchViewer");
  const owners = await Promise.all(Array.from({ length: 8 }, (_, i) => person(`BatchOwner${i}`)));
  await ProfileRelationship.create([
    { actor: viewer._id, target: owners[0]._id, type: "FOLLOW" },
    { actor: viewer._id, target: owners[1]._id, type: "FOLLOW" },
    { actor: owners[1]._id, target: viewer._id, type: "FOLLOW" },
  ]);
  await UserBlock.create({ blocker: owners[2]._id, blocked: viewer._id });
  await User.updateOne({ _id: owners[3]._id }, { $set: { status: "deactivated" } });
  await User.updateOne({ _id: owners[4]._id }, { $set: { status: "deleted" } });
  await PremiumMembership.collection.insertMany([3, 4, 5].map(i => ({ user: viewer._id, creator: owners[i]._id, status: "ACTIVE", currentPeriodEnd: new Date(Date.now() + 60000) })));
  const publication = new mongoose.Types.ObjectId();
  await Publication.collection.insertOne({ _id: publication, creator: owners[6]._id, kind: "WORLD" });
  await WorldEntitlement.collection.insertOne({ user: viewer._id, creator: owners[6]._id, publication, status: "ACTIVE" });
  const ids = [viewer._id, ...owners.map(owner => owner._id)];
  for (const viewerId of [viewer._id, null]) {
    const batched = await storyAudiencesByCreator(ids, viewerId);
    for (const id of ids) assert.deepEqual(batched.get(String(id)), await storyAudiencesFor(id, viewerId));
  }
  assert.deepEqual(await storyAudiencesByCreator([], viewer._id), new Map());
});

test("publication retries keep one story and one canonical mention notification", async () => {
  const owner = await person("Owner"); const mentioned = await person("Mentioned");
  const publishKey = String(new mongoose.Types.ObjectId());
  const body = { publishKey, editorMetadata: JSON.stringify({ mentions: [{ userId: String(mentioned._id), username: "forged" }, { userId: String(mentioned._id) }, { userId: String(owner._id) }] }) };
  const [first, second] = await Promise.all([publish(owner, body), publish(owner, body)]);
  assert.equal(String(first.id), String(second.id));
  assert.equal(await Story.countDocuments({ creator: owner._id, publishKey }), 1);
  assert.equal(first.editorMetadata.mentions.length, 1);
  assert.equal(first.editorMetadata.mentions[0].username, mentioned.username);
  const notifications = await Notification.find({ user: mentioned._id });
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].target.type, "STORY");
  assert.equal(String(notifications[0].target.id), String(first.id));
  assert.equal(await Notification.countDocuments({ user: owner._id, type: "story_mention_sent" }), 1);
  const received = (await invoke(getFanActivity, mentioned, { query: { direction: "received", filter: "mentions" } })).data.items;
  assert.equal(received.length, 1);
  assert.equal(received[0].preview, "Tap to add it to your story");
  assert.equal(received[0].route, `/stories/${first.id}`);
  const sent = (await invoke(getFanActivity, owner, { query: { direction: "sent", filter: "mentions" } })).data.items;
  assert.equal(sent.length, 1);
  assert.equal(sent[0].title, `You mentioned ${mentioned.name} in your story`);
  assert.equal(sent[0].relatedCreator.username, mentioned.username);
  assert.equal(sent[0].canAcknowledge, false);
  assert.equal(sent[0].route, `/stories/${first.id}`);
});

test("existing stories appear in Sent mentions without a notification and never duplicate after repair", async () => {
  const owner = await person("LegacyMentionOwner"); const mentioned = await person("LegacyMentionTarget");
  const story = await publish(owner, { editorMetadata: { mentions: [{ userId: String(mentioned._id) }] } });
  const saved = await Notification.findOne({ user: owner._id, type: "story_mention_sent" }).lean();
  await Notification.deleteOne({ _id: saved._id });
  const query = { direction: "sent", filter: "mentions" };
  let result = (await invoke(getFanActivity, owner, { query })).data;
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].route, `/stories/${story.id}`);
  assert.equal(result.items[0].relatedCreator.username, mentioned.username);
  assert.equal(await Notification.countDocuments({ user: owner._id }), 0);
  await Notification.collection.insertOne(saved);
  result = (await invoke(getFanActivity, owner, { query })).data;
  assert.equal(result.items.length, 1);
});

test("private audience checks apply to direct links, mentions and member expiry", async () => {
  const owner = await person("PrivateOwner"); const friend = await person("Friend"); const stranger = await person("Stranger");
  await ProfileRelationship.create([{ actor: owner._id, target: friend._id, type: "FOLLOW" }, { actor: friend._id, target: owner._id, type: "FOLLOW" }]);
  const story = await publish(owner, { audience: "friends", editorMetadata: { mentions: [{ userId: String(stranger._id) }, { userId: String(friend._id) }] } });
  assert.equal(story.audience, "close_circle");
  assert.match(story.mediaUrl, /authenticated/);
  assert.equal(story.editorMetadata.mentions.length, 1);
  assert.equal(String((await invoke(getStory, friend, { id: String(story.id) })).data.story.id), String(story.id));
  await assert.rejects(invoke(getStory, stranger, { id: String(story.id) }), /unavailable/);
  await PremiumMembership.collection.insertOne({ user: stranger._id, creator: owner._id, status: "CANCEL_AT_PERIOD_END", currentPeriodEnd: new Date(Date.now()+60000) });
  assert.equal((await storyAudiencesFor(owner._id, stranger._id)).has("world"), true);
  await PremiumMembership.updateMany({ user: stranger._id }, { $set: { currentPeriodEnd: new Date(0) } });
  assert.equal((await storyAudiencesFor(owner._id, stranger._id)).has("world"), false);
  await UserBlock.create({ blocker: owner._id, blocked: friend._id });
  await assert.rejects(invoke(getStory, friend, { id: String(story.id) }), /unavailable/);
});

test("buying an Experience never grants access to private World stories", async () => {
  const owner = await person("WorldOwner"); const viewer = await person("Buyer");
  const publication = new mongoose.Types.ObjectId();
  await Publication.collection.insertOne({ _id: publication, creator: owner._id, kind: "EXPERIENCE" });
  await WorldEntitlement.collection.insertOne({ user: viewer._id, creator: owner._id, publication, status: "ACTIVE" });
  assert.equal((await storyAudiencesFor(owner._id, viewer._id)).has("world"), false);
  await Publication.updateOne({ _id: publication }, { $set: { kind: "WORLD" } });
  assert.equal((await storyAudiencesFor(owner._id, viewer._id)).has("world"), true);
});

test("credited reshares require a public shareable story mentioning the actor", async () => {
  const owner = await person("Original"); const mentioned = await person("Tagged"); const other = await person("Other");
  const source = await publish(owner, { editorMetadata: { mentions: [{ userId: String(mentioned._id) }] } });
  const reshare = await publish(mentioned, { sourceStoryId: String(source.id), editorMetadata: { sharedCard: { destinationRoute: `/stories/${source.id}`, title: "Forged credit", scale: 1.7 } } });
  assert.equal(reshare.editorMetadata.sharedCard.scale, 1.7);
  assert.equal(reshare.editorMetadata.sharedCard.title, owner.name);
  assert.equal(reshare.editorMetadata.sourceStoryId, String(source.id));
  await assert.rejects(publish(other, { sourceStoryId: String(source.id) }), /cannot be reshared/);
  await Story.updateOne({ _id: source.id }, { $set: { audience: "followers" } });
  await assert.rejects(publish(mentioned, { sourceStoryId: String(source.id) }), /unavailable|cannot be reshared/);
  const documents = [await Story.findById(reshare.id).lean()];
  await resolveStorySources(documents, other._id);
  assert.equal(documents[0].sourceUnavailable, true);
  assert.equal(documents[0].editorMetadata.sharedCard.imageUrl, "");
  await Story.updateOne({ _id: source.id }, { $set: { expiresAt: new Date(0) } });
  await assert.rejects(invoke(getStory, owner, { id: String(source.id) }), /expired|unavailable/);
});

test("concurrent reactions update one DM card and removal preserves ordinary replies", async () => {
  const owner = await person("Receiver"); const sender = await person("Reactor");
  const published = await publish(owner); const story = await Story.findById(published.id);
  await Promise.all(Array.from({ length: 8 }, () => upsertStoryReactionMessage({ story, senderId: sender._id, reaction: "🔥" })));
  const original = await Message.findOne({ storyReactionKey: { $exists: true }, sender: sender._id });
  const readAt = new Date(); await Message.updateOne({ _id: original._id }, { $set: { readAt } });
  await invoke(reactStory, sender, { id: String(story._id), body: { reaction: "❤️" } });
  assert.equal((await invoke(getStory, sender, { id: String(story._id) })).data.story.viewerReaction, "❤️");
  assert.equal(await Message.countDocuments({ sender: sender._id, "storyReply.story": story._id }), 1);
  assert.equal((await Message.findById(original._id)).readAt.getTime(), readAt.getTime());
  const reply = await invoke(replyStory, sender, { id: String(story._id), body: { body: "An ordinary reply" } });
  const notification = await Notification.findOne({ type: "story_reply", user: owner._id });
  assert.equal(String(notification.target.messageId), reply.data.message.id);
  assert.equal(String(notification.target.conversationUserId), String(sender._id));
  await invoke(reactStory, sender, { id: String(story._id), body: { reaction: null } });
  assert.equal((await Message.findById(original._id)).body, "Story reaction removed");
  assert.equal((await Message.findById(reply.data.message.id)).body, "An ordinary reply");
  assert.equal(await Notification.countDocuments({ type: "story_reaction", user: owner._id }), 0);
});

test("notification preferences suppress mention activity", async () => {
  const owner = await person("NotifyOwner"); const mentioned = await person("Quiet");
  await FanProfile.create({ user: mentioned._id, notificationPreferences: { inApp: false } });
  await publish(owner, { editorMetadata: { mentions: [{ userId: String(mentioned._id) }] } });
  assert.equal(await Notification.countDocuments({ user: mentioned._id }), 0);
  assert.equal(await Notification.countDocuments({ user: owner._id, type: "story_mention_sent" }), 1);
});

test("Activity resolves current story previews and acknowledges only the selected notification", async () => {
  const owner = await person("ActivityOwner"); const mentioned = await person("ActivityViewer");
  const first = await publish(owner, { editorMetadata: { mentions: [{ userId: String(mentioned._id) }] } });
  const second = await publish(owner, { editorMetadata: { mentions: [{ userId: String(mentioned._id) }] } });
  let activity = (await invoke(getFanActivity, mentioned)).data;
  assert.equal(activity.unreadCount, 2);
  const row = activity.items.find((item) => String(item.target?.id) === String(first.id));
  assert.equal(row.route, `/stories/${first.id}`);
  assert.equal(row.relatedCreator.username, owner.username);
  assert.ok(row.metadata.imageUrl);
  await invoke(acknowledgeFanActivity, mentioned, { id: row.id });
  activity = (await invoke(getFanActivity, mentioned)).data;
  assert.equal(activity.unreadCount, 1);
  assert.equal(activity.items.find((item) => String(item.target?.id) === String(second.id)).acknowledged, false);
  await Story.updateOne({ _id: first.id }, { $set: { expiresAt: new Date(0) } });
  const expired = (await invoke(getFanActivity, mentioned)).data.items.find((item) => item.id === row.id);
  assert.equal(expired.route, `/stories/${first.id}`);
  assert.equal(expired.metadata.imageUrl, undefined);
});

test("reply targets load older messages without skipping history or revealing another conversation", async () => {
  const owner = await person("ThreadOwner"); const viewer = await person("ThreadViewer"); const outsider = await person("Unrelated");
  await Conversation.create({ fan: viewer._id, creator: owner._id, status: "ACTIVE" });
  const messages = [];
  for (let index = 0; index < 5; index++) messages.push(await Message.create({ sender: owner._id, recipient: viewer._id, body: `Reply ${index}` }));
  const unrelated = await Message.create({ sender: outsider._id, recipient: owner._id, body: "Private unrelated message" });
  const focused = (await invoke(listMessages, viewer, { id: String(owner._id), query: { limit: 2, focusMessageId: String(messages[0]._id) } })).data;
  assert.equal(focused.messages.some((message) => message.id === String(messages[0]._id)), true);
  assert.equal(focused.pageInfo.nextCursor, String(messages[3]._id));
  const next = (await invoke(listMessages, viewer, { id: String(owner._id), query: { limit: 2, cursor: focused.pageInfo.nextCursor } })).data;
  assert.equal(next.messages.some((message) => message.id === String(messages[2]._id)), true);
  const denied = (await invoke(listMessages, viewer, { id: String(owner._id), query: { limit: 2, focusMessageId: String(unrelated._id) } })).data;
  assert.equal(denied.messages.some((message) => message.id === String(unrelated._id)), false);
});
