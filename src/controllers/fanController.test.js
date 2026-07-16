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
