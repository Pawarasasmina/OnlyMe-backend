import Referral from "../models/Referral.js";
import ReferralEarning from "../models/ReferralEarning.js";
import { creditWallet, debitWallet } from "./walletLedgerService.js";
import ApiError from "../utils/ApiError.js";
import { FINANCIAL_ERROR_CODES } from "../constants/financialConstants.js";

const ELIGIBLE = new Set(["EXPERIENCE_PURCHASE", "WORLD_PURCHASE", "PREMIUM_JOIN", "PREMIUM_RENEWAL", "DREAM_GIFT", "CHAT_GIFT"]);
export const referralRewardStars = (grossStars) => Math.floor(Number(grossStars || 0) * 0.05);

export async function awardReferralEarnings({ fromUser, toUser, amount, referenceType, sourceDebit, sourceCredit, publication, creator, command, idempotencyKey }, session) {
  if (!ELIGIBLE.has(referenceType) || command.financialMode === "TEST") return [];
  const now = new Date();
  const candidates = await Promise.all([
    Referral.findOne({ invitee: fromUser, type: "friend", expiresAt: { $gt: now } }).session(session),
    Referral.findOne({ invitee: toUser, type: "creator", expiresAt: { $gt: now } }).session(session),
  ]);
  const definitions = [
    { referral: candidates[0], referredUser: fromUser, relationshipType: "friend", source: sourceDebit },
    { referral: candidates[1], referredUser: toUser, relationshipType: "creator", source: sourceCredit },
  ];
  const rewardStars = referralRewardStars(amount);
  if (rewardStars < 1) return [];
  const results = [];
  for (const item of definitions) {
    if (!item.referral || String(item.referral.inviter) === String(fromUser) || String(item.referral.inviter) === String(toUser)) continue;
    const exists = await ReferralEarning.exists({ referral: item.referral._id, sourceLedgerEntry: item.source.entry._id, relationshipType: item.relationshipType }).session(session);
    if (exists) continue;
    const credited = await creditWallet({ user: item.referral.inviter, amount: rewardStars, earnedAmount: rewardStars, entryType: "REFERRAL_CREATOR_EARNING", entryRole: "REFERRER_EARNING", referenceType: "REFERRAL_REWARD", referenceId: item.source.entry._id, publication, creator, counterpartyUser: item.referredUser, command, idempotencyKey, metadata: { grossStars: amount, rewardRate: 0.05, relationshipType: item.relationshipType, sourceType: referenceType, sourceLedgerEntry: String(item.source.entry._id), settlementStatus: "SETTLED" } }, session);
    const [earning] = await ReferralEarning.create([{ referral: item.referral._id, referrer: item.referral.inviter, referredUser: item.referredUser, sourceLedgerEntry: item.source.entry._id, rewardLedgerEntry: credited.entry._id, relationshipType: item.relationshipType, sourceType: referenceType, grossStars: amount, rewardStars }], { session });
    results.push(earning);
  }
  return results;
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
