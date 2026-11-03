import StarsLedgerEntry from "../models/StarsLedgerEntry.js";

export const SPENDING_LIMIT_OPTIONS_USD = [0, 25, 50, 100, 250, 500, 1000];
export const SPENDING_EVENTS = ["WORLD_PURCHASE_DEBIT", "PREMIUM_JOIN_DEBIT", "PREMIUM_RENEWAL_DEBIT", "PREMIUM_WAITLIST_HOLD_DEBIT", "VERIFIED_CREATOR_DEBIT", "DREAM_GIFT_DEBIT", "CHAT_GIFT_DEBIT", "DA_HOLD_DEBIT", "CALL_HOLD_DEBIT"];
export function validSpendingLimit(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1000 && Math.abs(Math.round(value * 100) - value * 100) < 1e-8;
}
export function spendingLimitExceeded(limit, spent, next) {
  return limit > 0 && spent + next - limit > 1e-9;
}
export async function monthlyWalletSpending(user, financialMode, rate, session) {
  // Calendar month in UTC, shared by display and transactional enforcement.
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const query = StarsLedgerEntry.aggregate([
    { $match: { accountUser: user, financialMode: financialMode === "TEST" ? "TEST" : { $ne: "TEST" }, entryType: { $in: SPENDING_EVENTS }, createdAt: { $gte: start } } },
    { $group: { _id: null, stars: { $sum: "$starsAmount" }, usd: { $sum: { $ifNull: ["$metadata.spendingUsd", { $divide: ["$starsAmount", rate] }] } } } },
  ]);
  if (session) query.session(session);
  const [row] = await query;
  return { spentThisMonthStars: Number(row?.stars || 0), spentThisMonthUsd: Number(row?.usd || 0) };
}
