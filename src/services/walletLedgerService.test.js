import test from "node:test";
import assert from "node:assert/strict";
import Wallet from "../models/Wallet.js";
import { creditWallet, debitWallet, debitBuckets, rebuildWalletBuckets, safeWallet, transferStars } from "./walletLedgerService.js";

test("Wallet projection tracks non-negative integer source balances", () => {
  for (const path of ["balance", "bonusBalance", "purchasedBalance", "earnedBalance"]) assert.equal(Wallet.schema.path(path).options.min, 0);
  assert.equal(Wallet.schema.path("version").options.default, 0);
  const invalid = new Wallet({ user: "000000000000000000000001", balance: 1.5 });
  assert.ok(invalid.validateSync());
  assert.deepEqual(safeWallet({ balance: 9, bonusBalance: 2, purchasedBalance: 3, earnedBalance: 4, version: 2 }), { balance: 5, bonusBalance: 2, purchasedBalance: 3, earnedBalance: 4, version: 2, currency: "STARS" });
});

test("spending cannot consume creator earnings", async () => {
  const wallet = { bonusBalance: 10, purchasedBalance: 40, earnedBalance: 1000 };
  assert.deepEqual(await debitBuckets(wallet, 50), { bonus: 10, purchased: 40, earned: 0 });
  await assert.rejects(debitBuckets(wallet, 51), { code: "INSUFFICIENT_STARS" });
  await assert.rejects(debitBuckets({ earnedBalance: 1000 }, 1), { code: "INSUFFICIENT_STARS" });
  assert.deepEqual(await debitBuckets(wallet, 20, null, null, "CREATOR_EARNING_REVERSAL"), { bonus: 0, purchased: 0, earned: 20 });
});

test("historical Wallet entries rebuild bonus, purchased, and earned sources in spending order", () => {
  const rows = [
    { _id: "topup", direction: "CREDIT", entryType: "WALLET_TOPUP_CREDIT", starsAmount: 150, metadata: { bonusStars: 50 } },
    { _id: "earning", direction: "CREDIT", entryType: "DA_CREATOR_EARNING", starsAmount: 80, metadata: {} },
    { _id: "spend", direction: "DEBIT", entryType: "WORLD_PURCHASE_DEBIT", starsAmount: 170, metadata: {} },
  ];
  assert.deepEqual(rebuildWalletBuckets(rows), { bonus: 0, purchased: 0, earned: 60 });
});

test("refunds restore the exact source buckets used by the original debit", () => {
  const rows = [
    { _id: "topup", direction: "CREDIT", entryType: "WALLET_TOPUP_CREDIT", starsAmount: 110, metadata: { bonusStars: 10 } },
    { _id: "spend", direction: "DEBIT", entryType: "WORLD_PURCHASE_DEBIT", starsAmount: 50, metadata: {} },
    { _id: "refund", direction: "CREDIT", entryType: "REFUND_CREDIT", starsAmount: 50, reversalOf: "spend", metadata: {} },
  ];
  assert.deepEqual(rebuildWalletBuckets(rows), { bonus: 10, purchased: 100, earned: 0 });
});

test("ledger service exposes only transaction-scoped mutation primitives", () => {
  assert.equal(typeof creditWallet, "function");
  assert.equal(typeof debitWallet, "function");
  assert.equal(typeof transferStars, "function");
});
