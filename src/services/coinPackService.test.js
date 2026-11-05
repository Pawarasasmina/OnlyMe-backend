import test from "node:test";
import assert from "node:assert/strict";
import { priceWithTax, WEB_COIN_PACKS, WEB_COIN_USD } from "./coinPackService.js";

test("web coin catalogue follows 1.49 dollars per 10 purchased coins and image bonuses", () => {
  assert.equal(WEB_COIN_USD, 0.149);
  assert.deepEqual(WEB_COIN_PACKS.map(({ stars, bonusStars, subtotalUsd }) => [stars, bonusStars, subtotalUsd]), [
    [50, 0, 7.49], [100, 5, 14.99], [300, 20, 44.99], [500, 50, 74.49], [1000, 150, 148.99], [2500, 500, 372.49],
  ]);
});

test("manual web tax is added and rounded to cents", () => {
  assert.deepEqual(priceWithTax(14.99, 10), { subtotalUsd: 14.99, taxPercent: 10, taxUsd: 1.5, totalUsd: 16.49 });
});
