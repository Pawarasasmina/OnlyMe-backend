import test from "node:test";
import assert from "node:assert/strict";
import { CLEARING_LEVELS, clearingCutoff, isTopCreatorPayoutTotal } from "./creatorClearingService.js";

test("documented clearing levels use 14, 7 and 3 days", () => {
  assert.deepEqual(CLEARING_LEVELS.NEW, { key: "NEW", days: 14 });
  assert.deepEqual(CLEARING_LEVELS.TRUSTED, { key: "TRUSTED", days: 7 });
  assert.deepEqual(CLEARING_LEVELS.TOP, { key: "TOP", days: 3 });
  assert.equal(clearingCutoff(CLEARING_LEVELS.TRUSTED, new Date("2026-11-05T00:00:00.000Z")).toISOString(), "2026-10-29T00:00:00.000Z");
});

test("top clearing uses cumulative paid withdrawals and a strict threshold", () => {
  assert.equal(isTopCreatorPayoutTotal(1000, 1000), false);
  assert.equal(isTopCreatorPayoutTotal(1000.01, 1000), true);
  assert.equal(isTopCreatorPayoutTotal(400 + 350 + 251, 1000), true);
});
