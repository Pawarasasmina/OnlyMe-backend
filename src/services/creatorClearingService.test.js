import test from "node:test";
import assert from "node:assert/strict";
import { CLEARING_LEVELS, clearingCutoff } from "./creatorClearingService.js";

test("documented clearing levels use 14 days for new and 7 for trusted creators", () => {
  assert.deepEqual(CLEARING_LEVELS.NEW, { key: "NEW", days: 14 });
  assert.deepEqual(CLEARING_LEVELS.TRUSTED, { key: "TRUSTED", days: 7 });
  assert.equal(clearingCutoff(CLEARING_LEVELS.TRUSTED, new Date("2026-11-05T00:00:00.000Z")).toISOString(), "2026-10-29T00:00:00.000Z");
});
