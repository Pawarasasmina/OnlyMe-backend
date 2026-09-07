import assert from "node:assert/strict";
import test from "node:test";
import { fanDashboardTestUtils } from "./fanController.js";

test("fan subscription summary separates active, expiring, and inactive records", () => {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const subscriptions = [
    { status: "active", isExpiringSoon: true, nextRenewalDate: tomorrow },
    { status: "active", isExpiringSoon: false },
    { status: "cancelled", isExpiringSoon: false },
    { status: "expired", isExpiringSoon: false },
  ];

  assert.deepEqual(fanDashboardTestUtils.subscriptionSummary(subscriptions), {
    active: 2,
    expiringSoon: 1,
    cancelledOrExpired: 2,
    monthlySpendCents: null,
  });
});

test("fan subscription filters support all expected states", () => {
  const subscriptions = [
    { status: "active", isExpiringSoon: true },
    { status: "cancelled", isExpiringSoon: false },
    { status: "expired", isExpiringSoon: false },
  ];

  assert.equal(fanDashboardTestUtils.filterSubscriptions(subscriptions, "all").length, 3);
  assert.equal(fanDashboardTestUtils.filterSubscriptions(subscriptions, "active").length, 1);
  assert.equal(fanDashboardTestUtils.filterSubscriptions(subscriptions, "cancelled").length, 1);
  assert.equal(fanDashboardTestUtils.filterSubscriptions(subscriptions, "expired").length, 1);
  assert.equal(fanDashboardTestUtils.filterSubscriptions(subscriptions, "expiringSoon").length, 1);
});

test("expiring soon only applies to active subscriptions with nearby dates", () => {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  assert.equal(fanDashboardTestUtils.isExpiringSoon({ status: "active", nextRenewalAt: tomorrow }), true);
  assert.equal(fanDashboardTestUtils.isExpiringSoon({ status: "active", nextRenewalAt: nextMonth }), false);
  assert.equal(fanDashboardTestUtils.isExpiringSoon({ status: "expired", nextRenewalAt: tomorrow }), false);
});

test("fan dashboard helpers avoid unsafe inferred data", () => {
  assert.equal(fanDashboardTestUtils.profileCompletion({ name: "Fan", username: "fan", avatar: "" }), 67);
  assert.equal(fanDashboardTestUtils.transactionDirection({ type: "credit", amount: -10 }), "credit");
  assert.equal(fanDashboardTestUtils.transactionDirection({ type: "unknown", amount: -10 }), "debit");
  assert.equal(fanDashboardTestUtils.messagePreview({ body: "hello     creator" }), "hello creator");
  assert.equal(fanDashboardTestUtils.messagePreview({ mediaType: "image" }), "Sent an image");
  assert.equal(fanDashboardTestUtils.messagePreview({ deletedAt: new Date() }), "Message unavailable");
});

test("activity helpers serialize received and sent follows from structured users", () => {
  const row = {
    _id: "follow1",
    actor: { _id: "fan1", name: "Fan One", username: "fan-one", avatar: "/fan.jpg" },
    target: { _id: "creator1", name: "Creator One", username: "creator-one" },
    createdAt: new Date("2026-09-01T10:00:00.000Z"),
  };

  const received = fanDashboardTestUtils.followActivity(row, "received");
  const sent = fanDashboardTestUtils.followActivity(row, "sent");

  assert.equal(received.direction, "received");
  assert.equal(received.filter, "follows");
  assert.equal(received.title, "Fan One started following you");
  assert.equal(received.actionPath, "/profile/fan-one");
  assert.equal(sent.direction, "sent");
  assert.equal(sent.title, "You followed Creator One");
  assert.equal(sent.canAcknowledge, false);
});

test("activity helpers aggregate received saves by target without inventing actors", () => {
  const publication = { _id: "seen1", title: "Morning Espresso Ritual", kind: "SEEN", summary: "Counter seats halve the wait." };
  const rows = [
    { _id: "save1", type: "SAVE", publication, user: { _id: "fan1", name: "Fan One" }, createdAt: new Date("2026-09-01T10:00:00.000Z") },
    { _id: "save2", type: "SAVE", publication, user: { _id: "fan2", name: "Fan Two" }, createdAt: new Date("2026-09-01T11:00:00.000Z") },
  ];

  const [activity] = fanDashboardTestUtils.groupedSaveActivities(rows, { source: "seen" });

  assert.equal(activity.type, "seen_save_group");
  assert.equal(activity.direction, "received");
  assert.equal(activity.filter, "saves");
  assert.equal(activity.title, "2 people saved your Seen");
  assert.deepEqual(activity.aggregate, { count: 2 });
  assert.equal(activity.relatedCreator, null);
  assert.equal(activity.actionPath, "/seen/seen1");
});

test("activity helpers use updated timestamps for mutable reactions", () => {
  const publication = { _id: "seen1", title: "Morning Espresso Ritual", kind: "SEEN", summary: "Counter seats halve the wait." };
  const reaction = {
    _id: "reaction1",
    type: "REACTION",
    reaction: "FIRE",
    publication,
    user: { _id: "fan1", name: "Fan One" },
    createdAt: new Date("2026-08-01T10:00:00.000Z"),
    updatedAt: new Date("2026-09-02T10:00:00.000Z"),
  };
  const comment = {
    ...reaction,
    _id: "comment1",
    type: "COMMENT",
    text: "This is the quiet one.",
  };

  assert.equal(fanDashboardTestUtils.engagementTime(reaction).toISOString(), "2026-09-02T10:00:00.000Z");
  assert.equal(fanDashboardTestUtils.engagementActivity(reaction, { direction: "received", source: "seen" }).createdAt.toISOString(), "2026-09-02T10:00:00.000Z");
  assert.equal(fanDashboardTestUtils.engagementTime(comment).toISOString(), "2026-08-01T10:00:00.000Z");
});

test("activity helpers serialize sent feed post comments and reactions", () => {
  const post = {
    _id: "post1",
    text: "Tiny launch note",
    author: { _id: "creator1", name: "Creator One", username: "creator-one", avatar: "/creator.jpg" },
    reactions: [
      {
        _id: "reaction1",
        user: { _id: "fan1", name: "Fan One" },
        reaction: "fire",
        createdAt: new Date("2026-09-01T10:00:00.000Z"),
        updatedAt: new Date("2026-09-02T10:00:00.000Z"),
      },
    ],
    comments: [
      {
        _id: "comment1",
        user: { _id: "fan1", name: "Fan One" },
        text: "This is useful.",
        createdAt: new Date("2026-09-02T11:00:00.000Z"),
      },
    ],
    saves: [],
  };

  const activity = fanDashboardTestUtils.feedPostEngagementActivities([post], { direction: "sent", fanId: "fan1" });
  const reaction = activity.find((item) => item.type === "feed_post_reaction");
  const comment = activity.find((item) => item.type === "feed_post_comment");

  assert.equal(activity.length, 2);
  assert.equal(reaction.direction, "sent");
  assert.equal(reaction.filter, "support");
  assert.equal(reaction.title, "You reacted with Fire to Creator One's note");
  assert.equal(reaction.actionPath, "/posts/post1");
  assert.equal(comment.direction, "sent");
  assert.equal(comment.filter, "comments");
  assert.equal(comment.preview, "This is useful.");
});

test("activity helpers preserve system and moderation notification categories", () => {
  const warning = fanDashboardTestUtils.notificationActivity({
    _id: "warn1",
    type: "moderation_warning",
    title: "Account warning",
    message: "Please follow our community rules.",
    severity: "critical",
    priority: 80,
    createdAt: new Date("2026-09-01T10:00:00.000Z"),
  });
  const earning = fanDashboardTestUtils.notificationActivity({
    _id: "earn1",
    type: "wallet",
    title: "WORLD CREATOR EARNING",
    message: "",
    createdAt: new Date("2026-09-01T11:00:00.000Z"),
  });

  assert.equal(warning.filter, "moderation");
  assert.deepEqual(warning.filterKeys, ["system"]);
  assert.equal(warning.warningId, "warn1");
  assert.equal(warning.actionPath, "/settings/support/safety");
  assert.equal(earning.filter, "earnings");
  assert.deepEqual(earning.filterKeys, ["earnings"]);
});

test("activity helpers filter by direction and category without dropping aliases", () => {
  const rows = [
    { id: "follow1", direction: "received", filter: "follows", filterKeys: ["follows"] },
    { id: "save1", direction: "received", filter: "saves", filterKeys: ["saves", "seen"] },
    { id: "purchase1", direction: "sent", filter: "purchases", filterKeys: ["purchases"] },
  ];

  assert.deepEqual(
    fanDashboardTestUtils.filterActivityItems(rows, { direction: "received", filter: "seen" }).map((item) => item.id),
    ["save1"],
  );
  assert.deepEqual(
    fanDashboardTestUtils.filterActivityItems(rows, { direction: "sent", filter: "all" }).map((item) => item.id),
    ["purchase1"],
  );
});

test("activity helpers count only unread received acknowledgable rows", () => {
  const rows = [
    { direction: "received", canAcknowledge: true, acknowledged: false, read: false },
    { direction: "received", canAcknowledge: true, acknowledged: true, read: false },
    { direction: "sent", canAcknowledge: true, acknowledged: false, read: false },
    { direction: "received", canAcknowledge: false, acknowledged: false, read: false },
  ];

  assert.equal(fanDashboardTestUtils.unreadActivityCount(rows), 1);
});
