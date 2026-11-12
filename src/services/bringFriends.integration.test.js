import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import User from "../models/User.js";
import Referral from "../models/Referral.js";
import Message from "../models/Message.js";
import Conversation from "../models/Conversation.js";
import { attributeReferral, referralCodes, resolveReferral } from "./referralService.js";
import { awardReferralEarnings } from "./referralFinancialService.js";
import { getMyInvitations } from "../controllers/profileController.js";
import { sendSharedContent } from "../controllers/messageController.js";
import { invitationLanding, joinInvitation } from "./invitationLandingService.js";
import InvitationFan from "../models/InvitationFan.js";
import ProfileRelationship from "../models/ProfileRelationship.js";
import Publication from "../models/Publication.js";
import UserBlock from "../models/UserBlock.js";

let server;
before(async () => { server = await MongoMemoryServer.create(); await mongoose.connect(server.getUri()); await Promise.all([User.init(), Referral.init(), Message.init()]); });
after(async () => { await mongoose.disconnect(); await server?.stop(); });
let seq = 0;
const person = name => { const n = ++seq; return User.create({ name, username: `friend_${n}`, email: `friend_${n}@example.test`, password: "TestPassword123", role: "fan" }); };

test("invitation landing uses published covers and joins once without toggling follow", async () => {
  await Promise.all([InvitationFan.init(), ProfileRelationship.init()]);
  const owner = await person("Landing owner"), fan = await person("Landing fan");
  const code = referralCodes(owner).friend;
  await Publication.collection.insertMany([
    { creator: owner._id, kind: "SEEN", visibility: "PUBLIC", status: "PUBLISHED", publishedSnapshot: { metadata: { title: "Published title", coverMedia: { secureUrl: "https://example.test/cover.jpg", resourceType: "image" } } } },
    { creator: owner._id, kind: "SEEN", visibility: "PRIVATE", status: "PUBLISHED", publishedSnapshot: { metadata: { title: "Secret" } } },
  ]);
  const landing = await invitationLanding(code, fan);
  assert.equal(landing.previews.length, 1);
  assert.equal(landing.previews[0].title, "Published title");
  const first = await joinInvitation(code, fan), second = await joinInvitation(code, fan);
  assert.equal(first.number, second.number);
  assert.equal(await InvitationFan.countDocuments({ inviter: owner._id }), 1);
  assert.equal(await ProfileRelationship.countDocuments({ actor: fan._id, target: owner._id, type: "FOLLOW" }), 1);
  const updated = await invitationLanding(code, fan);
  assert.equal(updated.joinedCount, 1);
  assert.equal(updated.fanNumber, first.number);
  const ownerList = await call(getMyInvitations, { user: await User.findById(owner._id) });
  assert.equal(ownerList.joinedCount, 1);
  assert.equal(ownerList.friends[0].id, String(fan._id));
  assert.equal(ownerList.friends[0].username, fan.username);
  assert.equal((await call(getMyInvitations, { user: fan })).friends.length, 0);
  await attributeReferral({ code, invitee: fan });
  assert.equal((await call(getMyInvitations, { user: owner })).joinedCount, 1);
  for (const name of ["Second joiner", "Third joiner"]) await joinInvitation(code, await person(name));
  assert.ok((await User.findById(owner._id)).friendInviteRingEarnedAt, "third join awards the ring before opening Bring friends");
  const threeJoined = await call(getMyInvitations, { user: await User.findById(owner._id) });
  assert.equal(threeJoined.joinedCount, 3);
  assert.equal(threeJoined.ringEarned, true);
  assert.ok((await User.findById(owner._id)).friendInviteRingEarnedAt);
  assert.equal(JSON.stringify(updated).includes(String(fan._id)), false);
  await assert.rejects(joinInvitation(code, owner), /yourself/);
  const blocked = await person("Blocked fan");
  await UserBlock.create({ blocker: owner._id, blocked: blocked._id });
  await assert.rejects(joinInvitation(code, blocked), /unavailable/);
  await assert.rejects(invitationLanding("invalid", fan), /not found/);
});
async function call(handler, req) { let response; await handler(req, { status() { return this; }, json(body) { response = body.data; } }, error => { throw error; }); return response; }

test("three real friends unlock a permanent ring and private lists are scoped to the inviter", async () => {
  const owner = await person("Owner"), other = await person("Other inviter");
  const friends = await Promise.all([person("Anna"), person("Omar"), person("Mia")]);
  const code = referralCodes(owner).friend;
  assert.equal((await resolveReferral(code)).inviter.username, owner.username);
  for (let i = 0; i < friends.length; i++) {
    await attributeReferral({ code, invitee: friends[i] });
    const data = await call(getMyInvitations, { user: await User.findById(owner._id) });
    assert.equal(data.joinedCount, i + 1);
    assert.equal(data.ringEarned, i === 2);
  }
  const earned = (await User.findById(owner._id)).friendInviteRingEarnedAt;
  assert.ok(earned);
  await attributeReferral({ code, invitee: friends[0] });
  assert.equal(await Referral.countDocuments({ inviter: owner._id }), 3);
  const otherData = await call(getMyInvitations, { user: other });
  assert.equal(otherData.joinedCount, 0);
  assert.deepEqual(otherData.friends, []);
  // Status remains earned when a joined account is subsequently deactivated.
  await User.updateOne({ _id: friends[0]._id }, { $set: { status: "inactive" } });
  const data = await call(getMyInvitations, { user: await User.findById(owner._id) });
  assert.equal(data.joinedCount, 2);
  assert.equal(data.ringEarned, true);
});

test("join without telling creates no attribution, and personal invites never award money", async () => {
  const owner = await person("Private inviter"), silent = await person("Private joiner"), visible = await person("Visible joiner");
  const code = referralCodes(owner).friend;
  assert.equal(await attributeReferral({ code, invitee: silent, shareIdentity: false }), null);
  assert.equal(await Referral.countDocuments({ invitee: silent._id }), 0);
  const referral = await attributeReferral({ code, invitee: visible });
  assert.equal(referral.rewardEligible, false);
  assert.deepEqual(await awardReferralEarnings({ fromUser: visible._id, toUser: new mongoose.Types.ObjectId(), amount: 100, referenceType: "WORLD_PURCHASE", command: { financialMode: "LIVE" } }, null), []);
  assert.equal(await attributeReferral({ code, invitee: owner }), null);
});

test("chat invitations use the sender's real code and reject spoofing another inviter", async () => {
  const sender = await person("Max Carter"), recipient = await person("Recipient");
  const request = owner => ({ user: sender, app: { get: () => null }, body: { recipientIds: [String(recipient._id)], sharedContent: { contentType: "invitation", contentId: String(owner._id) } } });
  const data = await call(sendSharedContent, request(sender));
  assert.equal(data.failed.length, 0);
  const message = await Message.findOne({ sender: sender._id, recipient: recipient._id });
  assert.equal(message.sharedContent.route, `/invite/${referralCodes(sender).friend}`);
  assert.equal(message.sharedContent.title, "Max invited you to @seen");
  assert.equal(message.body, "\u21aa Link \u2014 Max invited you to @seen");
  await assert.rejects(call(sendSharedContent, request(recipient)), /Only your own invitation/);
});

test("ticket shares use server-owned member data and respect ticket privacy", async () => {
  const sender = await person("Ticket owner"), recipient = await person("Ticket recipient");
  const request = owner => ({ user: sender, app: { get: () => null }, body: { recipientIds: [String(recipient._id)], sharedContent: { contentType: "ticket", contentId: String(owner._id), ticket: { number: 9999, city: "Fake city" } } } });
  const data = await call(sendSharedContent, request(sender));
  assert.equal(data.failed.length, 0);
  const message = await Message.findOne({ sender: sender._id, recipient: recipient._id });
  assert.equal(message.sharedContent.contentType, "ticket");
  assert.equal(message.sharedContent.ticket.number, sender.memberNumber);
  assert.equal(message.sharedContent.ticket.city, "");
  assert.equal(message.sharedContent.ticket.joinedAt.toISOString(), sender.createdAt.toISOString());
  assert.equal(message.sharedContent.title, `I’m №${sender.memberNumber.toLocaleString("en-US")} on @seen`);
  assert.equal(data.sent[0].message.sharedContent.ticket.number, sender.memberNumber);
  await Conversation.updateMany({ participants: sender._id }, { $set: { status: "ACTIVE", acceptedByCreator: true } });
  const reshared = await call(sendSharedContent, { ...request(sender), user: recipient, body: { recipientIds: [String(sender._id)], sharedContent: { contentType: "ticket", contentId: String(sender._id) } } });
  assert.equal(reshared.sent[0].message.sharedContent.ticket.number, sender.memberNumber);
  await UserBlock.create({ blocker: sender._id, blocked: recipient._id });
  await assert.rejects(call(sendSharedContent, request(recipient)), /This ticket cannot be shared/);
  await User.updateOne({ _id: sender._id }, { $set: { showMemberNumber: false } });
  await assert.rejects(call(sendSharedContent, request(sender)), /Ticket not available/);
});
