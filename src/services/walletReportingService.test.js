import assert from "node:assert/strict";
import test from "node:test";
import { walletLedgerReport } from "./walletReportingService.js";
const entry = (id, amount, type, bucket, mode = "REAL_SEED") => ({ _id: id, createdAt: `2026-11-${id.padStart(2, "0")}T00:00:00Z`, direction: amount > 0 ? "CREDIT" : "DEBIT", entryType: type, starsAmount: Math.abs(amount), signedAmount: amount, financialMode: mode, balanceAfter: 999999, metadata: { [amount > 0 ? "bucketCredit" : "bucketSpend"]: bucket } });
test("separate running balances ignore corrupt combined snapshots and isolate test money", () => {
  const rows = [entry("1", 100, "WALLET_TOPUP_CREDIT", { purchased: 100 }), entry("2", 35000, "MANUAL_ADJUSTMENT", { earned: 35000 }), entry("3", -30, "WORLD_PURCHASE_DEBIT", { purchased: 30 }), entry("4", 40, "CREDIT_ADMIN", { purchased: 40 }, "TEST")];
  const wallet = { bonusBalance: 0, purchasedBalance: 70, earnedBalance: 35000, testPurchasedBalance: 40 };
  const report = walletLedgerReport(wallet, rows.reverse());
  assert.equal(report.reconciliation, "MATCHED");
  assert.equal(report.fanCoins, 70);
  assert.equal(report.creatorEarningsUsd, 3500);
  assert.deepEqual(report.fanLedger.map((row) => row.walletBalance), [70, 100]);
  assert.equal(report.earningsLedger[0].walletBalance, 3500);
  assert.equal(report.earningsLedger[0].adjustment, true);
  assert.equal(walletLedgerReport(wallet, rows, "TEST").fanCoins, 40);
});
test("missing history produces a reconciliation warning instead of silently changing balances", () => {
  const report = walletLedgerReport({ purchasedBalance: 50 }, []);
  assert.equal(report.reconciliation, "DRIFT");
  assert.equal(report.fanCoins, 50);
});
