import test from "node:test";
import assert from "node:assert/strict";
import ReferralEarning from "../models/ReferralEarning.js";
import { referralRewardStars } from "./referralFinancialService.js";

test("creator referral rewards are one dollar per ten earned, rounded down", () => {
  assert.equal(referralRewardStars(190), 19);
  assert.equal(referralRewardStars(20), 2);
  assert.equal(referralRewardStars(9), 0);
});

test("referral earning source identity is unique", () => {
  assert.ok(ReferralEarning.schema.indexes().some(([keys, options]) => keys.referral === 1 && keys.sourceLedgerEntry === 1 && keys.relationshipType === 1 && options.unique));
});
