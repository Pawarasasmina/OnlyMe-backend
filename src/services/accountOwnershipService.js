import User from "../models/User.js";
import Wallet from "../models/Wallet.js";
import StarsLedgerEntry from "../models/StarsLedgerEntry.js";
import PremiumMembership from "../models/PremiumMembership.js";
import { financialModeForAccountType } from "../constants/accountTypeConstants.js";
import { rebuildWalletBuckets } from "./walletLedgerService.js";
import { getStarExchangeRate } from "./starExchangeService.js";
import ApiError from "../utils/ApiError.js";
import LegalHold from "../models/LegalHold.js";

export const DELETION_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
export function canRestoreAccount(user, now = new Date()) {
  return user.status === "deactivated" || (user.status === "pending_deletion" && new Date(user.deletionScheduledAt).getTime() > now.getTime());
}

export async function accountOwnershipSummary(user) {
  const test = financialModeForAccountType(user.accountType) === "TEST";
  const [wallet, rate] = await Promise.all([Wallet.findOne({ user: user._id }).lean(), getStarExchangeRate()]);
  const balance = Number(test ? wallet?.testBalance : wallet?.balance) || 0;
  let buckets = { bonus: Number(test ? wallet?.testBonusBalance : wallet?.bonusBalance) || 0, purchased: Number(test ? wallet?.testPurchasedBalance : wallet?.purchasedBalance) || 0, earned: Number(test ? wallet?.testEarnedBalance : wallet?.earnedBalance) || 0 };
  if (buckets.bonus + buckets.purchased + buckets.earned !== balance) {
    buckets = rebuildWalletBuckets(await StarsLedgerEntry.find({ accountUser: user._id, financialMode: test ? "TEST" : { $ne: "TEST" } }).sort({ createdAt: 1, _id: 1 }).lean());
  }
  return { unwithdrawnUsd: Math.max(0, buckets.earned) / rate, graceDays: 30 };
}

export async function changeAccountOwnership(user, action, acknowledgeEarningsLoss, now = new Date()) {
  if (user.role === "admin") throw new ApiError(403, "Administrator accounts cannot be changed here");
  if (action === "delete" && await LegalHold.exists({ targetType: "USER", targetId: String(user._id), active: true })) throw new ApiError(423, "This account is currently subject to a deletion hold", "LEGAL_HOLD_ACTIVE");
  if (action === "delete" && !acknowledgeEarningsLoss) {
    const summary = await accountOwnershipSummary(user);
    if (summary.unwithdrawnUsd > 0) throw new ApiError(409, "Withdraw your earnings first, or confirm that you want to delete anyway", "UNWITHDRAWN_EARNINGS");
  }
  const updated = await User.findOneAndUpdate({ _id: user._id, status: "active" }, {
    $set: action === "delete" ? { status: "pending_deletion", deletionRequestedAt: now, deletionScheduledAt: new Date(now.getTime() + DELETION_GRACE_MS) } : { status: "deactivated", deactivatedAt: now },
    $inc: { authVersion: 1 },
  }, { new: true, runValidators: true });
  if (!updated) throw new ApiError(409, "Account state has changed. Please log in again.");
  // Keep the current paid period open; neither side should be billed while inactive.
  await PremiumMembership.updateMany({ $or: [{ creator: user._id }, { user: user._id }], status: "ACTIVE", cancelAtPeriodEnd: false }, { $set: { cancelAtPeriodEnd: true, canceledAt: now, status: "CANCEL_AT_PERIOD_END" } });
  return updated;
}
