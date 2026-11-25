import test from "node:test";
import assert from "node:assert/strict";
import Payout from "../models/Payout.js";
import { PAYOUT_POLICY } from "../constants/payoutPolicy.js";
import { CLEARING_LEVELS } from "./creatorClearingService.js";
import { payoutTransitionAllowed } from "./payoutService.js";

test("payout rules preserve 14/7/3 clearing and 20/50 thresholds", () => {
  assert.deepEqual(Object.values(CLEARING_LEVELS).map((level) => level.days), [14, 7, 3]);
  assert.equal(PAYOUT_POLICY.automaticMinimumUsd, 20);
  assert.equal(PAYOUT_POLICY.requestedMinimumUsd, 50);
});

test("payout lifecycle permits failed retry but no terminal replay", () => {
  assert.equal(payoutTransitionAllowed("PENDING", "PROCESSING"), true);
  assert.equal(payoutTransitionAllowed("PROCESSING", "PAID"), true);
  assert.equal(payoutTransitionAllowed("PROCESSING", "FAILED"), true);
  assert.equal(payoutTransitionAllowed("FAILED", "PROCESSING"), true);
  assert.equal(payoutTransitionAllowed("PAID", "PROCESSING"), false);
  assert.equal(payoutTransitionAllowed("CANCELED", "PROCESSING"), false);
});

test("payouts persist retry count and immutable operational history", () => {
  assert.ok(Payout.schema.path("retryCount"));
  assert.ok(Payout.schema.path("statusHistory"));
});
