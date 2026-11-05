import test from "node:test";
import assert from "node:assert/strict";
import Payout from "./Payout.js";

test("payout records retain status, trigger, amount, and immutable financial references", () => {
  for (const field of ["user", "ledgerEntry", "command", "trigger", "status", "starsAmount", "usdAmount"]) assert.ok(Payout.schema.path(field));
  assert.deepEqual(Payout.schema.path("status").enumValues, ["PENDING", "PROCESSING", "PAID", "FAILED", "CANCELED"]);
  assert.equal(Payout.schema.path("ledgerEntry").options.unique, true);
  assert.equal(Payout.schema.path("command").options.unique, true);
});
