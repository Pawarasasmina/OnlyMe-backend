import Notification from "../models/Notification.js";
import User from "../models/User.js";
import IdentityVerification from "../models/IdentityVerification.js";
import CreatorVerification from "../models/CreatorVerification.js";
import VerifiedCreatorSubscription from "../models/VerifiedCreatorSubscription.js";
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

export async function synchronizeIdentityBadge(user) {
  if (!user || user.status && user.status !== "active") return user;
  const [manual, provider] = await Promise.all([
    CreatorVerification.exists({ creator: user._id, purpose: "IDENTITY", status: "APPROVED", stateSyncPending: false }),
    IdentityVerification.exists({ user: user._id, status: "verified", sealRevokedAt: null }),
  ]);
  if ((manual || provider) && !user.isVerified) {
    await User.updateOne({ _id: user._id, status: "active", isVerified: { $ne: true } }, { $set: { isVerified: true } });
    user.isVerified = true;
  }
  return user;
}

export async function expireVerifiedCreator(userId, now = new Date()) {
  if (await CreatorVerification.exists({ creator: userId, purpose: "IDENTITY", status: "APPROVED", stateSyncPending: false })) return null;
  if (await IdentityVerification.exists({ user: userId, status: "verified", sealRevokedAt: null })) return null;
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
  const identityIds = await IdentityVerification.find({ status: "verified" }).distinct("user");
  const manualIds = await CreatorVerification.find({ purpose: "IDENTITY", status: "APPROVED", stateSyncPending: false }).distinct("creator");
  const due = await VerifiedCreatorSubscription.find({ creator: { $nin: [...identityIds, ...manualIds] }, status: "APPROVED", currentPeriodEnd: { $lte: now } }).select("creator").lean();
  for (const item of due) await expireVerifiedCreator(item.creator, now);
  return due.length;
}

export async function payVerifiedCreator() {
  throw new ApiError(410, "Paid verification has been retired. Complete identity verification in Settings.");
}

// Preserve confirmed identity seals while historical paid badges run out.
export async function reconcileVerifiedCreatorBadges(now = new Date()) {
  await processVerifiedCreatorRenewals(now);
  const subscriptionIds = await VerifiedCreatorSubscription.find({ status: "APPROVED", paymentStatus: "PAID", currentPeriodEnd: { $gt: now } }).distinct("creator");
  const identityIds = await IdentityVerification.find({ status: "verified", sealRevokedAt: null }).distinct("user");
  const manualIds = await CreatorVerification.find({ purpose: "IDENTITY", status: "APPROVED", stateSyncPending: false }).distinct("creator");
  const activeCreatorIds = [...subscriptionIds, ...identityIds, ...manualIds];
  await Promise.all([
    User.updateMany({ creatorApprovalStatus: "approved", _id: { $nin: activeCreatorIds }, isVerified: true }, { $set: { isVerified: false } }),
    User.updateMany({ _id: { $in: activeCreatorIds }, isVerified: false }, { $set: { isVerified: true } }),
  ]);
}
