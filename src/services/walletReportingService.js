import { rebuildWalletBuckets, safeWallet } from "./walletLedgerService.js";

export function walletLedgerReport(wallet = {}, entries = [], mode = "REAL_SEED") {
  const selected = entries.filter((entry) => (entry.financialMode || "REAL_SEED") === mode)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || String(a._id).localeCompare(String(b._id)));
  const fan = [], earnings = [];
  const balances = safeWallet(wallet, mode);
  let rebuilt, error;
  try {
    rebuilt = rebuildWalletBuckets(selected, (entry, totals, allocation) => {
      const sign = entry.direction === "CREDIT" ? 1 : -1;
      const fanChange = sign * (Number(allocation.bonus || 0) + Number(allocation.purchased || 0));
      const earningsChange = sign * Number(allocation.earned || 0);
      const row = { ...entry, adjustment: ["MANUAL_ADJUSTMENT", "CREDIT_ADMIN", "OPENING_BALANCE"].includes(entry.entryType) };
      if (fanChange) fan.push({ ...row, walletChange: fanChange, walletBalance: totals.bonus + totals.purchased });
      if (earningsChange) earnings.push({ ...row, walletChange: earningsChange / 10, walletBalance: totals.earned / 10 });
    });
  } catch (failure) { error = failure.message; }
  const rawBalance = mode === "TEST" ? wallet.testBalance : wallet.balance;
  const matches = !error && rebuilt.bonus === balances.bonusBalance && rebuilt.purchased === balances.purchasedBalance && rebuilt.earned === balances.earnedBalance && (rawBalance == null || rawBalance === rebuilt.bonus + rebuilt.purchased + rebuilt.earned);
  return {
    mode, fanCoins: balances.balance, creatorEarningsUsd: balances.earnedBalance / 10,
    reconciliation: matches ? "MATCHED" : "DRIFT",
    reconciliationMessage: matches ? "" : "Ledger history does not reconcile with stored wallet balances. Financial review is required.",
    fanLedger: error ? [] : fan.reverse(), earningsLedger: error ? [] : earnings.reverse(),
  };
}
