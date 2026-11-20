import Referral from "../models/Referral.js";
import ReferralEarning from "../models/ReferralEarning.js";
import { creditWallet, debitWallet } from "./walletLedgerService.js";
import ApiError from "../utils/ApiError.js";
import { FINANCIAL_ERROR_CODES } from "../constants/financialConstants.js";
import StarsLedgerEntry from "../models/StarsLedgerEntry.js";
import { getCreatorReferralPolicy } from "./creatorReferralPolicyService.js";
import { getStarExchangeRate } from "./starExchangeService.js";

const ELIGIBLE = new Set(["EXPERIENCE_PURCHASE", "SEEN_PURCHASE", "WORLD_PURCHASE", "PREMIUM_JOIN", "PREMIUM_RENEWAL", "DREAM_GIFT", "CHAT_GIFT", "DIRECT_ACCESS", "DIRECT_ACCESS_WINDOW", "PAID_CALL"]);
export const referralRewardStars = (grossStars) => Math.floor(Number(grossStars || 0) * 0.10);

export async function awardReferralEarnings({ fromUser, toUser, amount, referenceType, sourceDebit, sourceCredit, publication, creator, command, idempotencyKey }, session) {
  const policy = await getCreatorReferralPolicy();
  if (!policy.enabled || !ELIGIBLE.has(referenceType) || command.financialMode === "TEST" || !sourceCredit?.entry) return [];
  const now = new Date();
  const referral = await Referral.findOne({ invitee: toUser, type: "creator", rewardEligible: true, expiresAt: { $gt: now } }).session(session);
  if (!referral || String(referral.inviter) === String(fromUser) || String(referral.inviter) === String(toUser)) return [];
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [rate, prior, allRewards, platformGross] = await Promise.all([
    getStarExchangeRate(),
    ReferralEarning.aggregate([{ $match: { referral: referral._id, status: "SETTLED", createdAt: { $gte: monthStart } } }, { $group: { _id: null, gross: { $sum: "$grossStars" }, rewards: { $sum: "$rewardStars" } } }]).session(session),
    ReferralEarning.aggregate([{ $match: { status: "SETTLED", createdAt: { $gte: monthStart } } }, { $group: { _id: null, rewards: { $sum: "$rewardStars" } } }]).session(session),
    StarsLedgerEntry.aggregate([{ $match: { entryRole: "CREATOR_EARNING", direction: "CREDIT", financialMode: { $ne: "TEST" }, createdAt: { $gte: monthStart } } }, { $group: { _id: null, gross: { $sum: "$starsAmount" } } }]).session(session),
  ]);
  const monthlyGross = Number(prior[0]?.gross || 0) + Number(amount);
  if (monthlyGross < Math.ceil(policy.minimumCreatorMonthlyUsd * rate)) return [];
  const nominal = referralRewardStars(monthlyGross) - Number(prior[0]?.rewards || 0);
  const payable = nominal + Number(referral.deferredRewardStars || 0);
  const creatorMargin = Math.floor(monthlyGross * policy.assumedPlatformMarginPercent / 100);
  const creatorCap = Math.floor(creatorMargin * policy.creatorMarginCapPercent / 100) - Number(prior[0]?.rewards || 0);
  const netRevenue = Math.floor((Number(platformGross[0]?.gross || 0) + Number(amount)) * policy.assumedPlatformMarginPercent / 100);
  const globalCap = Math.floor(netRevenue * policy.monthlyNetRevenueCapPercent / 100) - Number(allRewards[0]?.rewards || 0);
  const rewardStars = Math.max(0, Math.min(payable, creatorCap, globalCap));
  const deferredRewardStars = Math.max(0, payable - rewardStars);
  if (rewardStars < 1) { await Referral.updateOne({ _id: referral._id }, { $set: { deferredRewardStars } }, { session }); return []; }
  const exists = await ReferralEarning.exists({ referral: referral._id, sourceLedgerEntry: sourceCredit.entry._id, relationshipType: "creator" }).session(session);
  if (exists) return [];
  const clearingAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const availableAt = new Date(Math.max(clearingAt.getTime(), new Date(referral.firstPayoutAt || 0).getTime()));
  const credited = await creditWallet({ user: referral.inviter, amount: rewardStars, earnedAmount: rewardStars, entryType: "REFERRAL_CREATOR_EARNING", entryRole: "REFERRER_EARNING", referenceType: "REFERRAL_REWARD", referenceId: sourceCredit.entry._id, publication, creator, counterpartyUser: toUser, command, idempotencyKey, metadata: { grossStars: amount, relationshipType: "creator", sourceType: referenceType, sourceLedgerEntry: String(sourceCredit.entry._id), settlementStatus: "SETTLED", availableAt } }, session);
  const [earning] = await ReferralEarning.create([{ referral: referral._id, referrer: referral.inviter, referredUser: toUser, sourceLedgerEntry: sourceCredit.entry._id, rewardLedgerEntry: credited.entry._id, relationshipType: "creator", sourceType: referenceType, grossStars: amount, rewardStars, availableAt }], { session });
  await Referral.updateOne({ _id: referral._id }, { $inc: { earningsAmount: rewardStars / rate }, $set: { latestEarningAmount: rewardStars / rate, deferredRewardStars } }, { session });
  return [earning];
}

export async function reverseReferralEarnings({ sourceEntries, command, idempotencyKey, reason }, session) {
  const earnings = await ReferralEarning.find({ sourceLedgerEntry: { $in: sourceEntries.filter(Boolean) }, status: "SETTLED" }).session(session);
  for (const earning of earnings) {
    let debited;
    try {
      debited = await debitWallet({ user: earning.referrer, amount: earning.rewardStars, entryType: "REFERRAL_EARNING_REVERSAL", entryRole: "REFERRER_REVERSAL", referenceType: "REFERRAL_REFUND", referenceId: earning._id, counterpartyUser: earning.referredUser, command, idempotencyKey, reversalOf: earning.rewardLedgerEntry, metadata: { reason, referralEarning: String(earning._id), settlementStatus: "REVERSED" } }, session);
    } catch (error) {
      if (error.code === FINANCIAL_ERROR_CODES.INSUFFICIENT_STARS) throw new ApiError(409, "Referral reward is insufficient for an atomic reversal; manual review is required", FINANCIAL_ERROR_CODES.CREATOR_REVERSAL_INSUFFICIENT_STARS);
      throw error;
    }
    earning.status = "REVERSED"; earning.reversedAt = new Date(); earning.reversalLedgerEntry = debited.entry._id;
    await earning.save({ session });
  }
  return earnings.length;
}
