import test from "node:test";
import assert from "node:assert/strict";
import User from "./User.js";
import AnalyticsEvent from "./AnalyticsEvent.js";
import Wallet from "./Wallet.js";
import StarsLedgerEntry from "./StarsLedgerEntry.js";

test("accounts and historical activity default to SEED", () => {
  assert.equal(User.schema.path("accountType").defaultValue, "SEED");
  assert.equal(AnalyticsEvent.schema.path("actorAccountType").defaultValue, "SEED");
});

test("wallet and ledger provide isolated TEST value", () => {
  assert.ok(Wallet.schema.path("testBalance"));
  assert.deepEqual(StarsLedgerEntry.schema.path("financialMode").enumValues, ["REAL_SEED", "TEST"]);
});
