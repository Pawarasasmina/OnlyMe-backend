import StarsLedgerEntry from "../models/StarsLedgerEntry.js";
import User from "../models/User.js";
import Payout from "../models/Payout.js";
import { getMonetizationPolicy } from "./monetizationService.js";

export const CLEARING_LEVELS = Object.freeze({
  NEW: Object.freeze({ key: "NEW", days: 14 }),
  TRUSTED: Object.freeze({ key: "TRUSTED", days: 7 }),
  TOP: Object.freeze({ key: "TOP", days: 3 }),
});

const DISPUTE_EVENTS = ["CREATOR_EARNING_REVERSAL", "REFERRAL_EARNING_REVERSAL"];
const TRUSTED_AFTER_DAYS = 60;
export const isTopCreatorPayoutTotal = (paidUsd, thresholdUsd) => Number(paidUsd || 0) > Number(thresholdUsd);

export async function creatorClearingLevel(userId, now = new Date()) {
  const [policy, paid] = await Promise.all([
    getMonetizationPolicy(),
    Payout.aggregate([{ $match: { user: userId, status: "PAID" } }, { $group: { _id: null, usd: { $sum: "$usdAmount" } } }]),
  ]);
  if (isTopCreatorPayoutTotal(paid[0]?.usd, policy.topCreatorPayoutThresholdUsd)) return CLEARING_LEVELS.TOP;
  const user = await User.findById(userId).select("createdAt").lean();
  if (!user?.createdAt) return CLEARING_LEVELS.NEW;
  const trustedSince = new Date(now.getTime() - TRUSTED_AFTER_DAYS * 86400000);
  if (new Date(user.createdAt) > trustedSince) return CLEARING_LEVELS.NEW;
  const dispute = await StarsLedgerEntry.exists({
    accountUser: userId,
    entryType: { $in: DISPUTE_EVENTS },
    createdAt: { $gte: trustedSince, $lte: now },
  });
  return dispute ? CLEARING_LEVELS.NEW : CLEARING_LEVELS.TRUSTED;
}

export const clearingCutoff = (level, now = new Date()) =>
  new Date(now.getTime() - level.days * 86400000);
