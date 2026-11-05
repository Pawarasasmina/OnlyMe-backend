import test from "node:test";
import assert from "node:assert/strict";
import { automaticPayoutMonthKey } from "./payoutService.js";
test("automatic payout month key is stable in UTC", () => { assert.equal(automaticPayoutMonthKey(new Date("2026-11-01T00:00:00.000Z")), "2026-11"); });
