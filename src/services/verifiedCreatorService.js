import Notification from "../models/Notification.js";
import User from "../models/User.js";
import VerifiedCreatorSubscription from "../models/VerifiedCreatorSubscription.js";
import { executeFinancialCommand } from "./financialCommandService.js";
import { debitWallet, safeWallet } from "./walletLedgerService.js";
import { fingerprint, idempotencyKey } from "../validators/financialValidator.js";
import { FINANCIAL_ERROR_CODES } from "../constants/financialConstants.js";
import ApiError from "../utils/ApiError.js";
import PlatformSetting from "../models/PlatformSetting.js";

export const VERIFIED_MONTHLY_STARS = 190;
const PRICE_SETTING_KEY = "VERIFIED_CREATOR_PLAN";

export async function getVerifiedCreatorPlan() {
  const setting = await PlatformSetting.findOne({ key: PRICE_SETTING_KEY }).lean();
  const starsPerMonth = Number(setting?.value?.starsPerMonth);
  return { starsPerMonth: Number.isSafeInteger(starsPerMonth) && starsPerMonth >= 1 ? starsPerMonth : VERIFIED_MONTHLY_STARS, currency: "STARS", updatedAt: setting?.updatedAt || null };
}

export async function updateVerifiedCreatorPlan(starsPerMonth, adminId) {
  const amount = Number(starsPerMonth);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000) throw new ApiError(400, "Monthly price must be a whole number from 1 to 1,000,000 Stars");
  const setting = await PlatformSetting.findOneAndUpdate({ key: PRICE_SETTING_KEY }, { $set: { value: { starsPerMonth: amount }, updatedBy: adminId }, $setOnInsert: { key: PRICE_SETTING_KEY } }, { new: true, upsert: true, runValidators: true });
  return { starsPerMonth: amount, currency: "STARS", updatedAt: setting.updatedAt };
}

export function addMonth(date = new Date()) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

export async function expireVerifiedCreator(userId, now = new Date()) {
  const subscription = await VerifiedCreatorSubscription.findOne({
    creator: userId,
    status: "APPROVED",
    currentPeriodEnd: { $lte: now },
  });
  if (!subscription) return null;

  subscription.status = "EXPIRED";
  subscription.paymentStatus = "PAST_DUE";
  if (!subscription.expiryNoticeSentAt) subscription.expiryNoticeSentAt = now;
  await Promise.all([
    subscription.save(),
    User.updateOne({ _id: userId }, { $set: { isVerified: false } }),
    Notification.updateOne(
      { dedupeKey: `verified-expired:${subscription._id}:${subscription.currentPeriodEnd?.toISOString()}` },
      { $setOnInsert: { user: userId, type: "verified_creator_expired", title: "Your verified badge has expired", message: "Your monthly renewal was not completed. Renew Verified Creator to restore the blue tick.", severity: "warning", priority: 70, dedupeKey: `verified-expired:${subscription._id}:${subscription.currentPeriodEnd?.toISOString()}` } },
      { upsert: true, runValidators: true }
    ),
  ]);
  return subscription;
}

export async function processVerifiedCreatorRenewals(now = new Date()) {
  const due = await VerifiedCreatorSubscription.find({ status: "APPROVED", currentPeriodEnd: { $lte: now } }).select("creator").lean();
  for (const item of due) {
    try {
      await payVerifiedCreator({ userId: item.creator, key: `verified-renew:${item.creator}:${now.toISOString().slice(0, 10)}`, now });
    } catch (error) {
      if ([FINANCIAL_ERROR_CODES.INSUFFICIENT_STARS, FINANCIAL_ERROR_CODES.WALLET_UNAVAILABLE].includes(error.code)) await expireVerifiedCreator(item.creator, now);
      else throw error;
    }
  }
  return due.length;
}

export async function payVerifiedCreator({ userId, key, now = new Date() }) {
  key = idempotencyKey(key);
  return executeFinancialCommand({ user: userId, commandType: "PAY_VERIFIED_CREATOR", idempotencyKey: key, requestFingerprint: fingerprint({ userId: String(userId) }) }, async (session, command) => {
    const subscription = await VerifiedCreatorSubscription.findOne({ creator: userId, status: { $in: ["PENDING", "APPROVED", "EXPIRED"] } }).session(session);
    if (!subscription) throw new ApiError(409, "Verified Creator approval is required");
    const periodStart = subscription.currentPeriodEnd > now ? subscription.currentPeriodEnd : now;
    const periodEnd = addMonth(periodStart);
    const debit = await debitWallet({ user: userId, amount: subscription.starsPerMonth, entryType: "VERIFIED_CREATOR_DEBIT", entryRole: "CREATOR_SUBSCRIPTION_DEBIT", referenceType: "VERIFIED_CREATOR", referenceId: subscription._id, creator: userId, command, idempotencyKey: key, metadata: { periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString() } }, session);
    subscription.status = "APPROVED"; subscription.paymentStatus = "PAID"; subscription.lastPaidAt = now; subscription.currentPeriodStart = periodStart; subscription.currentPeriodEnd = periodEnd; subscription.expiryNoticeSentAt = null; subscription.latestLedgerEntry = debit.entry._id;
    await subscription.save({ session });
    await User.updateOne({ _id: userId }, { $set: { isVerified: true } }, { session });
    return { resultReference: subscription._id, subscription: { id: subscription._id, status: subscription.status, starsPerMonth: subscription.starsPerMonth, paymentStatus: subscription.paymentStatus, currentPeriodStart: subscription.currentPeriodStart, currentPeriodEnd: subscription.currentPeriodEnd }, wallet: safeWallet(debit.wallet), isVerified: true };
  });
}

// The blue tick is subscription-backed. This also cleans legacy creator approvals
// that previously inherited isVerified without a separate verified plan.
export async function reconcileVerifiedCreatorBadges(now = new Date()) {
  await processVerifiedCreatorRenewals(now);
  const activeCreatorIds = await VerifiedCreatorSubscription.find({ status: "APPROVED", paymentStatus: "PAID", currentPeriodEnd: { $gt: now } }).distinct("creator");
  await Promise.all([
    User.updateMany({ creatorApprovalStatus: "approved", _id: { $nin: activeCreatorIds }, isVerified: true }, { $set: { isVerified: false } }),
    User.updateMany({ _id: { $in: activeCreatorIds }, isVerified: false }, { $set: { isVerified: true } }),
  ]);
}
