import Payout from "../models/Payout.js";
import { executeFinancialCommand } from "./financialCommandService.js";
import { creditWallet } from "./walletLedgerService.js";
import { fingerprint } from "../validators/financialValidator.js";
import ApiError from "../utils/ApiError.js";
import PayoutBankApplication from "../models/PayoutBankApplication.js";
import PayoutHold from "../models/PayoutHold.js";
import Wallet from "../models/Wallet.js";
import StarsLedgerEntry from "../models/StarsLedgerEntry.js";
import User from "../models/User.js";
import { getStarExchangeRate } from "./starExchangeService.js";
import { clearingCutoff, creatorClearingLevel } from "./creatorClearingService.js";
import { PAYOUT_POLICY } from "../constants/payoutPolicy.js";
import Notification from "../models/Notification.js";

const CREATOR_EVENTS = ["WORLD_CREATOR_EARNING", "PREMIUM_CREATOR_EARNING", "DREAM_CREATOR_EARNING", "CHAT_GIFT_EARNING", "DA_CREATOR_EARNING", "CALL_CREATOR_EARNING"];
export const payoutTransitionAllowed = (from, to) => ({ PENDING: ["PROCESSING", "FAILED", "CANCELED"], PROCESSING: ["PAID", "FAILED"], FAILED: ["PROCESSING"], PAID: [], CANCELED: [] }[from] || []).includes(to);

export async function transitionPayout({ payoutId, status, reason = "" }) {
  const current = await Payout.findById(payoutId).lean();
  if (!current) throw new ApiError(404, "Payout not found", "PAYOUT_NOT_FOUND");
  if (!payoutTransitionAllowed(current.status, status)) throw new ApiError(409, `Payout cannot move from ${current.status} to ${status}`, "INVALID_PAYOUT_TRANSITION");
  if (["PROCESSING", "PAID"].includes(status) && await PayoutHold.exists({ user: current.user, active: true })) {
    throw new ApiError(403, "Payouts are currently on administrative hold", "PAYOUT_ON_HOLD");
  }
  const restore = ["FAILED", "CANCELED"].includes(status);
  const retrying = current.status === "FAILED" && status === "PROCESSING";
  const key = `payout-status:${current._id}:${current.status}:${status}:${Number(current.retryCount || 0)}`;
  return executeFinancialCommand({ user: current.user, commandType: retrying ? "RETRY_PAYOUT" : ["FAILED", "CANCELED"].includes(status) ? "RESTORE_FAILED_PAYOUT" : "PAYOUT_STATUS_TRANSITION", idempotencyKey: key, requestFingerprint: fingerprint({ payoutId: String(current._id), from: current.status, status, reason, retryCount: current.retryCount || 0 }) }, async (session, command) => {
    const payout = await Payout.findOne({ _id: payoutId, status: current.status }).session(session);
    if (!payout) throw new ApiError(409, "Payout status changed", "PAYOUT_STATUS_CHANGED");
    let restoredEntry = null;
    let retryLedgerEntry = null;
    if (restore) {
      const restored = await creditWallet({ user: payout.user, amount: payout.starsAmount, earnedAmount: payout.starsAmount, entryType: "MANUAL_ADJUSTMENT", entryRole: "PAYOUT_REVERSAL", referenceType: "PAYOUT", referenceId: payout._id, command, idempotencyKey: key, reversalOf: payout.ledgerEntry, metadata: { reason: reason || status, payoutStatus: status } }, session);
      restoredEntry = restored.entry._id;
    }
    if (retrying) {
      const wallet = await Wallet.findOneAndUpdate({ user: payout.user, balance: { $gte: payout.starsAmount }, earnedBalance: { $gte: payout.starsAmount } }, { $inc: { balance: -payout.starsAmount, earnedBalance: -payout.starsAmount, version: 1 } }, { new: true, session, runValidators: true });
      if (!wallet) throw new ApiError(422, "Creator earnings are no longer sufficient to retry this payout", "PAYOUT_RETRY_BALANCE_INSUFFICIENT");
      const [reserved] = await StarsLedgerEntry.create([{ accountUser: payout.user, entryType: "CREATOR_WITHDRAWAL_DEBIT", entryRole: "CREATOR_PAYOUT_RETRY", direction: "DEBIT", starsAmount: payout.starsAmount, signedAmount: -payout.starsAmount, balanceAfter: wallet.balance, referenceType: "PAYOUT_RETRY", referenceId: String(payout._id), commandId: command._id, idempotencyKey: key, reversalOf: null, metadata: { payoutId: String(payout._id), retryAttempt: Number(payout.retryCount || 0) + 1, bucketSpend: { bonus: 0, purchased: 0, earned: payout.starsAmount }, usdAmount: payout.usdAmount } }], { session });
      await Wallet.updateOne({ _id: wallet._id }, { $set: { lastLedgerEntry: reserved._id } }, { session });
      retryLedgerEntry = reserved._id;
      payout.ledgerEntry = reserved._id;
      payout.retryCount += 1;
    }
    payout.status = status;
    payout.failureReason = status === "FAILED" ? reason : "";
    if (status === "PROCESSING") payout.processedAt = new Date();
    if (status === "PAID") payout.paidAt = new Date();
    payout.statusHistory.push({ status, reason, at: new Date(), ledgerEntry: retryLedgerEntry || restoredEntry || payout.ledgerEntry });
    await payout.save({ session });
    const notificationCopy = status === "PROCESSING" ? { type: retrying ? "payout_retried" : "payout_processing", title: retrying ? "Your payout is being retried" : "Your payout is processing", message: retrying ? `Retry ${payout.retryCount} has started.` : "Your payout is now being processed." } : status === "PAID" ? { type: "payout_paid", title: "Your payout was sent", message: `$${payout.usdAmount.toFixed(2)} has been marked as paid.` } : status === "FAILED" ? { type: "payout_failed", title: "Your payout could not be sent", message: `${reason} Your coins were returned to your creator balance.` } : { type: "payout_canceled", title: "Your payout was canceled", message: "The payout coins were returned to your creator balance." };
    await Notification.create([{ user: payout.user, ...notificationCopy, severity: status === "FAILED" ? "warning" : "info", dedupeKey: `payout:${payout._id}:${status}:${payout.retryCount}` , target: { type: "PAYOUT", id: payout._id }, metadata: { payoutId: String(payout._id), status, usdAmount: payout.usdAmount, starsAmount: payout.starsAmount, retryCount: payout.retryCount } }], { session });
    return { resultReference: payout._id, payout, restoredEntry, retryLedgerEntry };
  });
}

export const automaticPayoutMonthKey = (now = new Date()) => `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

export async function processAutomaticPayouts(now = new Date()) {
  if (now.getUTCDate() !== PAYOUT_POLICY.automaticDayOfMonth) return { skipped: true, created: 0 };
  const monthKey = automaticPayoutMonthKey(now);
  const banks = await PayoutBankApplication.find({ status: "APPROVED", automaticPayout: true }).select("user accountLast4").limit(500).lean();
  const starsPerUsd = await getStarExchangeRate();
  const minimumStars = Math.ceil(PAYOUT_POLICY.automaticMinimumUsd * starsPerUsd);
  let created = 0;
  for (const bank of banks) {
    if (await Payout.exists({ user: bank.user, trigger: "AUTOMATIC", monthKey })) continue;
    if (await PayoutHold.exists({ user: bank.user, active: true })) continue;
    if (!(await User.exists({ _id: bank.user, status: "active", accountType: { $ne: "TEST" } }))) continue;
    const level = await creatorClearingLevel(bank.user, now);
    const cutoff = clearingCutoff(level, now);
    const wallet = await Wallet.findOne({ user: bank.user }).lean();
    if (!wallet) continue;
    const recent = await StarsLedgerEntry.aggregate([{ $match: { accountUser: bank.user, financialMode: { $ne: "TEST" }, entryType: { $in: CREATOR_EVENTS }, createdAt: { $gt: cutoff } } }, { $lookup: { from: StarsLedgerEntry.collection.name, localField: "_id", foreignField: "reversalOf", as: "reversals" } }, { $match: { reversals: { $size: 0 } } }, { $group: { _id: null, stars: { $sum: "$signedAmount" } } }]);
    const amount = Math.max(0, Number(wallet.earnedBalance || 0) - Math.max(0, Number(recent[0]?.stars || 0)));
    if (amount < minimumStars) continue;
    const key = `automatic-payout:${bank.user}:${monthKey}`;
    try {
      await executeFinancialCommand({ user: bank.user, commandType: "AUTOMATIC_PAYOUT", idempotencyKey: key, requestFingerprint: fingerprint({ monthKey, amount, starsPerUsd }) }, async (session, command) => {
        const updated = await Wallet.findOneAndUpdate({ user: bank.user, balance: { $gte: amount }, earnedBalance: { $gte: amount } }, { $inc: { balance: -amount, earnedBalance: -amount, version: 1 } }, { new: true, session, runValidators: true });
        if (!updated) throw new ApiError(422, "Automatic payout balance changed", "INSUFFICIENT_WITHDRAWABLE_INCOME");
        const [entry] = await StarsLedgerEntry.create([{ accountUser: bank.user, entryType: "CREATOR_WITHDRAWAL_DEBIT", entryRole: "CREATOR_PAYOUT", direction: "DEBIT", starsAmount: amount, signedAmount: -amount, balanceAfter: updated.balance, referenceType: "CREATOR_WITHDRAWAL", referenceId: String(command._id), commandId: command._id, idempotencyKey: key, metadata: { bankLast4: bank.accountLast4, payoutProvider: "manual", bucketSpend: { bonus: 0, purchased: 0, earned: amount }, starsPerUsd, usdAmount: amount / starsPerUsd, trigger: "AUTOMATIC", monthKey } }], { session });
        const [payout] = await Payout.create([{ user: bank.user, ledgerEntry: entry._id, command: command._id, trigger: "AUTOMATIC", status: "PENDING", starsAmount: amount, usdAmount: amount / starsPerUsd, feeUsd: 0, bankLast4: bank.accountLast4, monthKey, statusHistory: [{ status: "PENDING", reason: "Automatic payout run", at: now, ledgerEntry: entry._id }] }], { session });
        await Wallet.updateOne({ _id: updated._id }, { $set: { lastLedgerEntry: entry._id } }, { session });
        await Notification.create([{ user: bank.user, type: "payout_created", title: "Automatic payout created", message: `$${(amount / starsPerUsd).toFixed(2)} is ready for payout processing.`, dedupeKey: `payout-created:${payout._id}`, target: { type: "PAYOUT", id: payout._id }, metadata: { payoutId: String(payout._id), trigger: "AUTOMATIC", starsAmount: amount, usdAmount: amount / starsPerUsd } }], { session });
        return { resultReference: payout._id, payoutId: payout._id };
      });
      created += 1;
    } catch (error) {
      console.error("Automatic payout creation failed", { userId: String(bank.user), code: error.code || "AUTOMATIC_PAYOUT_FAILED" });
    }
  }
  return { skipped: false, created };
}
