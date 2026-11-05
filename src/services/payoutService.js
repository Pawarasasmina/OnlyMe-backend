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

const CREATOR_EVENTS = ["WORLD_CREATOR_EARNING", "PREMIUM_CREATOR_EARNING", "DREAM_CREATOR_EARNING", "CHAT_GIFT_EARNING", "DA_CREATOR_EARNING", "CALL_CREATOR_EARNING"];

export async function transitionPayout({ payoutId, status, reason = "" }) {
  const current = await Payout.findById(payoutId).lean();
  if (!current) throw new ApiError(404, "Payout not found", "PAYOUT_NOT_FOUND");
  const transitions = { PENDING: ["PROCESSING", "FAILED", "CANCELED"], PROCESSING: ["PAID", "FAILED"], FAILED: ["PROCESSING"], PAID: [], CANCELED: [] };
  if (!transitions[current.status]?.includes(status)) throw new ApiError(409, `Payout cannot move from ${current.status} to ${status}`, "INVALID_PAYOUT_TRANSITION");
  const restore = ["FAILED", "CANCELED"].includes(status);
  const key = `payout-status:${current._id}:${status}`;
  return executeFinancialCommand({ user: current.user, commandType: "RESTORE_FAILED_PAYOUT", idempotencyKey: key, requestFingerprint: fingerprint({ payoutId: String(current._id), status, reason }) }, async (session, command) => {
    const payout = await Payout.findOne({ _id: payoutId, status: current.status }).session(session);
    if (!payout) throw new ApiError(409, "Payout status changed", "PAYOUT_STATUS_CHANGED");
    let restoredEntry = null;
    if (restore) {
      const restored = await creditWallet({ user: payout.user, amount: payout.starsAmount, earnedAmount: payout.starsAmount, entryType: "MANUAL_ADJUSTMENT", entryRole: "PAYOUT_REVERSAL", referenceType: "PAYOUT", referenceId: payout._id, command, idempotencyKey: key, reversalOf: payout.ledgerEntry, metadata: { reason: reason || status, payoutStatus: status } }, session);
      restoredEntry = restored.entry._id;
    }
    payout.status = status;
    payout.failureReason = status === "FAILED" ? reason : "";
    if (status === "PROCESSING") payout.processedAt = new Date();
    if (status === "PAID") payout.paidAt = new Date();
    await payout.save({ session });
    return { resultReference: payout._id, payout, restoredEntry };
  });
}

export const automaticPayoutMonthKey = (now = new Date()) => `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

export async function processAutomaticPayouts(now = new Date()) {
  if (now.getUTCDate() !== 1) return { skipped: true, created: 0 };
  const monthKey = automaticPayoutMonthKey(now);
  const banks = await PayoutBankApplication.find({ status: "APPROVED", automaticPayout: true }).select("user accountLast4").limit(500).lean();
  const starsPerUsd = await getStarExchangeRate();
  const minimumStars = Math.ceil(20 * starsPerUsd);
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
        const [payout] = await Payout.create([{ user: bank.user, ledgerEntry: entry._id, command: command._id, trigger: "AUTOMATIC", status: "PENDING", starsAmount: amount, usdAmount: amount / starsPerUsd, feeUsd: 0, bankLast4: bank.accountLast4, monthKey }], { session });
        await Wallet.updateOne({ _id: updated._id }, { $set: { lastLedgerEntry: entry._id } }, { session });
        return { resultReference: payout._id, payoutId: payout._id };
      });
      created += 1;
    } catch (error) {
      console.error("Automatic payout creation failed", { userId: String(bank.user), code: error.code || "AUTOMATIC_PAYOUT_FAILED" });
    }
  }
  return { skipped: false, created };
}
