import StarsLedgerEntry from "../models/StarsLedgerEntry.js";
import Wallet from "../models/Wallet.js";
import Payout from "../models/Payout.js";
import DAWindow from "../models/DAWindow.js";
import CallSession from "../models/CallSession.js";
import PlatformRevenue from "../models/PlatformRevenue.js";
import { getStarExchangeRate } from "./starExchangeService.js";
import ApiError from "../utils/ApiError.js";
import User from "../models/User.js";

const DAY = 24 * 60 * 60 * 1000;
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const round = (value) => Number(number(value).toFixed(2));
const periodKey = (date, interval) => {
  const value = new Date(date);
  return interval === "month" ? `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}` : value.toISOString().slice(0, 10);
};
export function moneyOverviewRange(query = {}) {
  const interval = query.interval === "month" ? "month" : "day";
  const end = query.to ? new Date(`${query.to}T23:59:59.999Z`) : new Date();
  const start = query.from ? new Date(`${query.from}T00:00:00.000Z`) : new Date(end.getTime() - 29 * DAY);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) throw new ApiError(400, "Choose a valid financial reporting range", "INVALID_REPORT_RANGE");
  if (end.getTime() - start.getTime() > 366 * DAY) throw new ApiError(400, "Money overview supports up to 366 days", "REPORT_RANGE_TOO_LARGE");
  return { start, end, interval };
}

export async function buildMoneyOverview(query = {}) {
  const { start, end, interval } = moneyOverviewRange(query);
  const dateMatch = { $gte: start, $lte: end };
  const [realUsers, excludedAccounts] = await Promise.all([User.find({ accountType: "REAL", role: { $in: ["fan", "creator"] } }).select("_id").lean(), User.countDocuments({ accountType: { $in: ["SEED", "TEST"] }, role: { $in: ["fan", "creator"] } })]);
  const realUserIds = realUsers.map((user) => user._id);
  const [topups, refunds, payouts, heldWindows, heldCalls, revenue, wallets, ledgerBalances, starsPerUsd] = await Promise.all([
    StarsLedgerEntry.find({ accountUser: { $in: realUserIds }, financialMode: { $ne: "TEST" }, entryType: "WALLET_TOPUP_CREDIT", createdAt: dateMatch }).select("starsAmount metadata createdAt").lean(),
    StarsLedgerEntry.find({ accountUser: { $in: realUserIds }, financialMode: { $ne: "TEST" }, direction: "CREDIT", entryRole: { $in: ["FAN_REFUND", "FAN_DA_REFUND", "FAN_CALL_REFUND"] }, createdAt: dateMatch }).select("starsAmount metadata createdAt").lean(),
    Payout.find({ user: { $in: realUserIds }, createdAt: dateMatch }).select("status starsAmount usdAmount feeUsd createdAt paidAt").lean(),
    DAWindow.find({ fan: { $in: realUserIds }, source: { $ne: "PREMIUM_INCLUDED" }, settlementStatus: { $in: ["HELD", "REFUND_PENDING"] } }).select("priceStars openedAt").lean(),
    CallSession.find({ caller: { $in: realUserIds }, paid: true, settlementStatus: { $in: ["HELD", "REFUND_PENDING"] } }).select("priceStars createdAt").lean(),
    PlatformRevenue.find({ fan: { $in: realUserIds }, financialMode: { $ne: "TEST" }, capturedAt: dateMatch }).select("platformStars capturedAt").lean(),
    Wallet.find({ user: { $in: realUserIds } }).select("user balance earnedBalance ledgerActivatedAt reconciliationStatus").lean(),
    StarsLedgerEntry.aggregate([{ $match: { accountUser: { $in: realUserIds }, financialMode: { $ne: "TEST" } } }, { $sort: { createdAt: 1, _id: 1 } }, { $group: { _id: "$accountUser", balance: { $sum: "$signedAmount" }, firstBalanceAfter: { $first: "$balanceAfter" }, firstSignedAmount: { $first: "$signedAmount" } } }]),
    getStarExchangeRate(),
  ]);
  const rows = new Map();
  const row = (date) => { const key = periodKey(date, interval); if (!rows.has(key)) rows.set(key, { period: key, webCoinsSold: 0, mobileCoinsSold: 0, grossUsd: 0, storeFeesUsd: 0, platformRevenueUsd: 0, payoutsScheduledUsd: 0, payoutsSentUsd: 0, payoutsFailedUsd: 0, refundsUsd: 0, chargebacksUsd: 0 }); return rows.get(key); };
  for (const item of topups) { const target = row(item.createdAt); target.webCoinsSold += number(item.metadata?.baseStars ?? item.starsAmount); target.grossUsd += number(item.metadata?.usdAmount); }
  for (const item of refunds) { const target = row(item.createdAt); target.refundsUsd += number(item.starsAmount) / number(item.metadata?.starsPerUsd || starsPerUsd); }
  for (const item of payouts) { const target = row(item.createdAt); if (["PENDING", "PROCESSING"].includes(item.status)) target.payoutsScheduledUsd += number(item.usdAmount); if (item.status === "PAID") target.payoutsSentUsd += number(item.usdAmount); if (item.status === "FAILED") target.payoutsFailedUsd += number(item.usdAmount); }
  for (const item of revenue) row(item.capturedAt).platformRevenueUsd += number(item.platformStars) / starsPerUsd;
  const table = [...rows.values()].sort((a, b) => a.period.localeCompare(b.period)).map((item) => Object.fromEntries(Object.entries(item).map(([key, value]) => [key, key === "period" ? value : round(value)])));
  const totals = table.reduce((result, item) => { for (const [key, value] of Object.entries(item)) if (key !== "period") result[key] = round(number(result[key]) + number(value)); return result; }, {});
  const ledgerByUser = new Map(ledgerBalances.map((item) => [String(item._id), item]));
  const reconciledWallets = wallets.filter((wallet) => Boolean(wallet.ledgerActivatedAt));
  const legacyWallets = wallets.filter((wallet) => !wallet.ledgerActivatedAt);
  const openingFor = (wallet) => { const ledger = ledgerByUser.get(String(wallet.user)); return ledger ? number(ledger.firstBalanceAfter) - number(ledger.firstSignedAmount) : number(wallet.balance); };
  const openingBalanceWallets = reconciledWallets.filter((wallet) => openingFor(wallet) !== 0);
  const expectedBalance = (wallet) => number(ledgerByUser.get(String(wallet.user))?.balance) + openingFor(wallet);
  const drift = reconciledWallets.filter((wallet) => number(wallet.balance) !== expectedBalance(wallet));
  const owedStars = wallets.reduce((sum, wallet) => sum + number(wallet.earnedBalance), 0);
  const heldStars = [...heldWindows, ...heldCalls].reduce((sum, item) => sum + number(item.priceStars), 0);
  totals.mobileCoinsSold ||= 0; totals.storeFeesUsd ||= 0; totals.chargebacksUsd ||= 0;
  return {
    range: { from: start.toISOString(), to: end.toISOString(), interval }, totals: { ...totals, owedToCreatorsStars: owedStars, owedToCreatorsUsd: round(owedStars / starsPerUsd), directAccessHeldStars: heldStars, directAccessHeldUsd: round(heldStars / starsPerUsd), netCashAfterRefundsUsd: round(number(totals.grossUsd) - number(totals.refundsUsd) - number(totals.chargebacksUsd) - number(totals.storeFeesUsd)) }, rows: table,
    integrations: { web: "CONNECTED", mobile: "NOT_INTEGRATED", apple: "NOT_INTEGRATED", googlePlay: "NOT_INTEGRATED", chargebacks: "NOT_INTEGRATED" },
    reconciliation: { status: drift.length ? "DIFFERENCE_DETECTED" : "PARTIAL", internalLedgerStatus: drift.length ? "DIFFERENCE_DETECTED" : openingBalanceWallets.length || legacyWallets.length ? "OPENING_BALANCE_GAPS" : "RECONCILED", walletCount: wallets.length, excludedSeedTestAccounts: excludedAccounts, reconciledWallets: reconciledWallets.length, legacyWallets: legacyWallets.length, openingBalanceWallets: openingBalanceWallets.length, driftWallets: drift.length, ledgerBalanceStars: reconciledWallets.reduce((sum, wallet) => sum + number(ledgerByUser.get(String(wallet.user))?.balance), 0), walletBalanceStars: reconciledWallets.reduce((sum, wallet) => sum + number(wallet.balance), 0), unrecordedOpeningBalanceStars: openingBalanceWallets.reduce((sum, wallet) => sum + openingFor(wallet), 0), legacyBalanceStars: legacyWallets.reduce((sum, wallet) => sum + number(wallet.balance), 0), note: drift.length ? "Real-account wallet balances differ after accounting for their starting balances." : openingBalanceWallets.length ? "Real-account transactions reconcile, but migrated starting balances need opening entries." : legacyWallets.length ? "Activated real-account wallets reconcile. Legacy wallets are reported separately until ledger activation." : "Real-account ledger reconciles. Seed and test accounts are excluded from platform totals." },
  };
}

const csvValue = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
export function moneyOverviewCsv(report) {
  const columns = ["period", "webCoinsSold", "mobileCoinsSold", "grossUsd", "storeFeesUsd", "platformRevenueUsd", "payoutsScheduledUsd", "payoutsSentUsd", "payoutsFailedUsd", "refundsUsd", "chargebacksUsd"];
  return [columns.join(","), ...report.rows.map((row) => columns.map((key) => csvValue(row[key] ?? 0)).join(","))].join("\n");
}
