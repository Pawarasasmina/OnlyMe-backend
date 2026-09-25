import assert from "node:assert/strict";
import test from "node:test";
import { CREATOR_EARNING_ROLE_PATTERN, percentageRows, sourceBucketForEntry, starsToUsd, totalContentViews } from "./creatorDashboardService.js";

test("creator dashboard includes every creator earning role and excludes non-earnings", () => {
  ["CREATOR_EARNING", "CREATOR_DA_EARNING", "CREATOR_CALL_EARNING", "CREATOR_FUTURE_SOURCE_EARNING"]
    .forEach((role) => assert.match(role, CREATOR_EARNING_ROLE_PATTERN));

  ["FAN_REFUND", "WALLET_TOPUP", "ADMIN_CREDIT", "CREATOR_REVERSAL", "INCOME_CONVERSION_CREDIT"]
    .forEach((role) => assert.doesNotMatch(role, CREATOR_EARNING_ROLE_PATTERN));
});

test("creator dashboard separates Experience unlocks from monthly World subscriptions", () => {
  assert.equal(sourceBucketForEntry({ entryType: "WORLD_CREATOR_EARNING", metadata: { publicationKind: "EXPERIENCE" } }), "unlocks");
  assert.equal(sourceBucketForEntry({ entryType: "WORLD_CREATOR_EARNING", referenceType: "EXPERIENCE_PURCHASE" }), "unlocks");
  assert.equal(sourceBucketForEntry({ entryType: "PREMIUM_CREATOR_EARNING" }), "worldSubscriptions");
  assert.equal(sourceBucketForEntry({ entryType: "WORLD_CREATOR_EARNING", metadata: { publicationKind: "WORLD" } }), "other");
});

test("totalContentViews combines Seen and wall analytics with story views", () => {
  assert.equal(totalContentViews({ analyticsViews: 125, storyViews: 30 }), 155);
  assert.equal(totalContentViews({ analyticsViews: 0, storyViews: 7 }), 7);
});

test("starsToUsd uses the configured Stars-per-USD rate", () => {
  assert.equal(starsToUsd(190, 10), 19);
  assert.equal(starsToUsd(190, 20), 9.5);
  assert.equal(starsToUsd(1, 3), 0.33);
});

test("starsToUsd safely handles an invalid exchange rate", () => {
  assert.equal(starsToUsd(190, 0), 0);
  assert.equal(starsToUsd(190, undefined), 0);
});

test("percentageRows allocates rounded percentages that total 100", () => {
  const rows = percentageRows([
    { label: "Discover", value: 2 },
    { label: "Wall", value: 1 },
    { label: "Seen", value: 1 },
  ]);

  assert.deepEqual(rows.map((row) => row.percent), [50, 25, 25]);
  assert.equal(rows.reduce((sum, row) => sum + row.percent, 0), 100);
});

test("percentageRows preserves empty source rows without fabricated percentages", () => {
  const rows = percentageRows([
    { label: "Discover", value: 0 },
    { label: "Wall", value: 0 },
  ]);

  assert.deepEqual(rows.map((row) => row.percent), [0, 0]);
});
