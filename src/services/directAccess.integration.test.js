import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import User from "../models/User.js";
import Wallet from "../models/Wallet.js";
import CreatorProfile from "../models/CreatorProfile.js";
import DAWindow from "../models/DAWindow.js";
import StarsLedgerEntry from "../models/StarsLedgerEntry.js";
import FinancialCommand from "../models/FinancialCommand.js";
import PlatformRevenue from "../models/PlatformRevenue.js";
import Conversation from "../models/Conversation.js";
import Notification from "../models/Notification.js";
import Message from "../models/Message.js";
import { captureDirectAccessWindow, createDirectAccessMessageAtomic, openDirectAccessWindow, refundDirectAccessWindow } from "./directAccessService.js";

const uri = process.env.TEST_MONGODB_URI;
let fan;
let creator;

before(async () => {
  if (!uri) return;
  await mongoose.connect(uri);
  await mongoose.connection.db.dropDatabase();
  await Promise.all([User, Wallet, CreatorProfile, DAWindow, StarsLedgerEntry, FinancialCommand, PlatformRevenue, Conversation, Notification, Message].map((model) => model.syncIndexes()));
  [fan, creator] = await User.create([
    { name: "DA Fan", username: "da_test_fan", email: "da-fan@test.local", password: "password123", role: "fan" },
    { name: "DA Creator", username: "da_test_creator", email: "da-creator@test.local", password: "password123", role: "creator", creatorApprovalStatus: "approved" },
  ]);
  await CreatorProfile.create({ user: creator._id, directAccessEnabled: true, directAccessPriceStars: 100 });
  await Wallet.create({ user: fan._id, balance: 500, currency: "STARS", ledgerActivatedAt: new Date(), reconciliationStatus: "MATCHED" });
});

after(async () => {
  if (!uri) return;
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

test("Direct Access concurrent opening creates one hold and one active window", { skip: !uri }, async () => {
  const attempts = await Promise.allSettled([
    openDirectAccessWindow({ fan, creatorId: creator._id, key: "da-open-concurrent-a" }),
    openDirectAccessWindow({ fan, creatorId: creator._id, key: "da-open-concurrent-b" }),
  ]);
  assert.equal(attempts.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(await DAWindow.countDocuments({ fan: fan._id, creator: creator._id, status: "OPEN" }), 1);
  assert.equal(await StarsLedgerEntry.countDocuments({ accountUser: fan._id, entryType: "DA_HOLD_DEBIT" }), 1);
  assert.equal((await Wallet.findOne({ user: fan._id })).balance, 400);
});

test("Direct Access capture credits 90 percent once and records 10 percent platform revenue", { skip: !uri }, async () => {
  const window = await DAWindow.findOne({ fan: fan._id, creator: creator._id, status: "OPEN" });
  const attempts = await Promise.allSettled([
    captureDirectAccessWindow(window._id, creator._id),
    captureDirectAccessWindow(window._id, creator._id),
  ]);
  assert.equal(attempts.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(await StarsLedgerEntry.countDocuments({ entryType: "DA_CREATOR_EARNING", referenceId: String(window._id) }), 1);
  assert.equal((await Wallet.findOne({ user: creator._id })).balance, 90);
  const revenue = await PlatformRevenue.findOne({ sourceType: "DIRECT_ACCESS", referenceId: String(window._id) });
  assert.equal(revenue.platformStars, 10);
  assert.equal(revenue.creatorStars, 90);
});

test("unanswered expiry refund is idempotent and restores the full fan amount", { skip: !uri }, async () => {
  await DAWindow.updateMany({}, { $unset: { activeWindowKey: 1 } });
  const opened = await openDirectAccessWindow({ fan, creatorId: creator._id, key: "da-open-refund-test" });
  const attempts = await Promise.allSettled([
    refundDirectAccessWindow(opened.window.id),
    refundDirectAccessWindow(opened.window.id),
  ]);
  assert.equal(attempts.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(await StarsLedgerEntry.countDocuments({ entryType: "DA_REFUND_CREDIT", referenceId: opened.window.id }), 1);
  assert.equal((await Wallet.findOne({ user: fan._id })).balance, 400);
});

test("fan message creation and three-message allowance are atomic", { skip: !uri }, async () => {
  await DAWindow.updateMany({}, { $unset: { activeWindowKey: 1 } });
  const opened = await openDirectAccessWindow({ fan, creatorId: creator._id, key: "da-open-message-limit" });
  const attempts = await Promise.allSettled([0, 1, 2, 3].map((index) => createDirectAccessMessageAtomic({
    windowId: opened.window.id,
    sender: fan,
    recipient: creator,
    message: { clientMessageId: `da-limit-message-${index}`, body: `Question ${index}`, mediaType: "text" },
  })));
  assert.equal(attempts.filter((item) => item.status === "fulfilled").length, 3);
  assert.equal(await Message.countDocuments({ directAccessWindow: opened.window.id, sender: fan._id }), 3);
  const closed = await DAWindow.findById(opened.window.id);
  assert.equal(closed.fanMessagesUsed, 3);
  assert.equal(closed.status, "CLOSED");
  assert.equal(closed.activeWindowKey, undefined);
});

test("first creator reply, 90/10 settlement and notification commit together", { skip: !uri }, async () => {
  const window = await DAWindow.findOne({ fan: fan._id, creator: creator._id, settlementStatus: "HELD" }).sort({ createdAt: -1 });
  const result = await createDirectAccessMessageAtomic({
    windowId: window._id,
    sender: creator,
    recipient: fan,
    message: { clientMessageId: "da-creator-first-reply", body: "My answer", mediaType: "text" },
  });
  assert.equal(result.window.settlementStatus, "CAPTURED");
  assert.equal(await Message.countDocuments({ directAccessWindow: window._id, sender: creator._id }), 1);
  assert.equal(await StarsLedgerEntry.countDocuments({ entryType: "DA_CREATOR_EARNING", referenceId: String(window._id) }), 1);
  assert.equal(await PlatformRevenue.countDocuments({ referenceId: String(window._id) }), 1);
  assert.equal(await Notification.countDocuments({ dedupeKey: `da-answer:${window._id}` }), 1);
});

test("creator-question reopen captures 80 percent for creator and links both windows", { skip: !uri }, async () => {
  const previous = await DAWindow.findOne({ fan: fan._id, creator: creator._id, status: "CLOSED", settlementStatus: "CAPTURED" }).sort({ createdAt: -1 });
  const question = await Message.create({
    sender: creator._id,
    recipient: fan._id,
    clientMessageId: "da-reopen-question",
    body: "What happened after you tried it?",
    messageKind: "CREATOR_ASK",
    directAccessWindow: previous._id,
  });
  const creatorBalanceBefore = (await Wallet.findOne({ user: creator._id })).balance;
  const opened = await openDirectAccessWindow({
    fan,
    creatorId: creator._id,
    key: "da-open-reopened-window",
    source: "CREATOR_REOPEN",
    creatorQuestionMessageId: question._id,
  });
  assert.equal(opened.window.reopenedFromWindowId, String(previous._id));
  await createDirectAccessMessageAtomic({
    windowId: opened.window.id,
    sender: creator,
    recipient: fan,
    message: { clientMessageId: "da-reopen-creator-reply", body: "Thanks for answering.", mediaType: "text" },
  });
  const revenue = await PlatformRevenue.findOne({ referenceId: opened.window.id });
  assert.equal(revenue.creatorStars, 80);
  assert.equal(revenue.platformStars, 20);
  assert.equal(revenue.rateBasisPoints, 2000);
  assert.equal((await Wallet.findOne({ user: creator._id })).balance, creatorBalanceBefore + 80);
});

test("fan free follow-up uses configured price and the same idempotency key cannot double-charge", { skip: !uri }, async () => {
  await DAWindow.updateMany({}, { $unset: { activeWindowKey: 1 } });
  await CreatorProfile.updateOne({ user: creator._id }, { $set: { directAccessPriceStars: 200 } });
  const previous = await DAWindow.findOne({ fan: fan._id, creator: creator._id, settlementStatus: { $in: ["CAPTURED", "INCLUDED"] } }).sort({ createdAt: -1 });
  const followup = await Message.create({ sender: fan._id, recipient: creator._id, clientMessageId: "fan-free-followup-configured-price", body: "Can you explain one more thing?", messageKind: "FAN_FREE_ASK", messageChannel: "DIRECT_ACCESS", directAccessWindow: previous._id });
  const balanceBefore = (await Wallet.findOne({ user: fan._id })).balance;
  const first = await openDirectAccessWindow({ fan, creatorId: creator._id, key: "fan-followup-open-idempotent", source: "FAN_FOLLOWUP", fanFollowupMessageId: followup._id });
  const replay = await openDirectAccessWindow({ fan, creatorId: creator._id, key: "fan-followup-open-idempotent", source: "FAN_FOLLOWUP", fanFollowupMessageId: followup._id });
  assert.equal(first.window.id, replay.window.id);
  assert.equal(first.window.priceStars, 200);
  assert.equal((await Wallet.findOne({ user: fan._id })).balance, balanceBefore - 200);
  assert.equal(await StarsLedgerEntry.countDocuments({ entryType: "DA_HOLD_DEBIT", referenceId: first.window.id }), 1);
  const answer = await createDirectAccessMessageAtomic({ windowId: first.window.id, sender: creator, recipient: fan, message: { clientMessageId: "fan-followup-creator-paid-reply", body: "Here is the deeper answer.", mediaType: "text" } });
  assert.equal(answer.window.settlementStatus, "CAPTURED");
  const revenue = await PlatformRevenue.findOne({ referenceId: first.window.id });
  assert.equal(revenue.creatorStars, 160);
  assert.equal(revenue.platformStars, 40);
});
