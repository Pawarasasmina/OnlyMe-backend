import test from "node:test";
import assert from "node:assert/strict";
import Publication from "../models/Publication.js";
import PremiumMembership from "../models/PremiumMembership.js";
import { PREMIUM_CREATOR_PAYOUT_SHARE, PREMIUM_PRICE_CHANGE_COOLDOWN_DAYS, PREMIUM_PRICE_PRESETS, PREMIUM_PRICE_TOP_TIER } from "../constants/publicationConstants.js";
import { creatorPayoutForStars, nextPriceChangeAt } from "./premiumWorldPricingService.js";

test("Premium World pricing constants match supported product tiers", () => {
  assert.deepEqual(PREMIUM_PRICE_PRESETS, [90, 190, 290, 390, 500, 1000]);
  assert.equal(PREMIUM_PRICE_TOP_TIER, 1000);
  assert.equal(PREMIUM_PRICE_CHANGE_COOLDOWN_DAYS, 30);
});

test("Creator payout estimate uses canonical star exchange and creator share", () => {
  assert.deepEqual(creatorPayoutForStars(290, 10), {
    amount: 19.72,
    currency: "USD",
  });
  assert.equal(PREMIUM_CREATOR_PAYOUT_SHARE, 0.68);
});

test("Next price change date is thirty days after last change", () => {
  assert.equal(nextPriceChangeAt(null), null);
  assert.equal(nextPriceChangeAt("2026-09-01T00:00:00.000Z").toISOString(), "2026-10-01T00:00:00.000Z");
});

test("Publication schema stores premium price cooldown and price history", () => {
  assert.ok(Publication.schema.path("pricingLastChangedAt"));
  assert.ok(Publication.schema.path("priceHistory"));
});

test("Premium membership snapshots resident renewal price independently of world price", () => {
  assert.ok(PremiumMembership.schema.path("starsPerPeriod")?.isRequired);
  assert.ok(PremiumMembership.schema.indexes().some(([keys]) => keys.currentPeriodEnd === 1 && keys.status === 1));
});
