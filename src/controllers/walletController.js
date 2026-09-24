import Wallet from "../models/Wallet.js";
import StarsLedgerEntry from "../models/StarsLedgerEntry.js";
import WorldEntitlement from "../models/WorldEntitlement.js";
import PremiumMembership from "../models/PremiumMembership.js";
import { getStarExchangeRate } from "../services/starExchangeService.js";
import { executeFinancialCommand } from "../services/financialCommandService.js";
import { creditWallet, rebuildWalletBuckets, safeWallet } from "../services/walletLedgerService.js";
import { fingerprint, idempotencyKey, positiveStars } from "../validators/financialValidator.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import ApiError from "../utils/ApiError.js";

const TOPUP_PACKS = {
  "4.99": { usd: 4.99, bonus: 0 },
  "9.99": { usd: 9.99, bonus: 5 },
  "29.99": { usd: 29.99, bonus: 20 },
  "49.99": { usd: 49.99, bonus: 50 },
  "99.99": { usd: 99.99, bonus: 150 },
  "249.99": { usd: 249.99, bonus: 500 },
};
const CREATOR_EVENTS = ["WORLD_CREATOR_EARNING", "PREMIUM_CREATOR_EARNING", "DREAM_CREATOR_EARNING", "CHAT_GIFT_EARNING", "DA_CREATOR_EARNING", "CALL_CREATOR_EARNING"];
const safePublication = (item) => item ? { id: item._id, title: item.title || item.publishedSnapshot?.metadata?.title || "", kind: item.kind, planet: item.planet || null } : null;
export function withdrawalBalances(earnedBalance, recentIncomeStars) {
  const pendingIncomeStars = Math.min(Math.max(0, Number(earnedBalance || 0)), Math.max(0, Number(recentIncomeStars || 0)));
  return { pendingIncomeStars, availableIncomeStars: Math.max(0, Number(earnedBalance || 0) - pendingIncomeStars) };
}

export const getWallet = asyncHandler(async (req, res) => {
  const now = new Date();
  const withdrawalCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const automaticFilter = { creator: req.user._id, status: "ACTIVE", cancelAtPeriodEnd: false, currentPeriodEnd: { $gt: now } };
  const [wallet, starsPerUsd, income, recentIncome, automaticMemberships, automaticSummary] = await Promise.all([
    Wallet.findOne({ user: req.user._id }).lean(),
    getStarExchangeRate(),
    StarsLedgerEntry.aggregate([{ $match: { accountUser: req.user._id, entryType: { $in: CREATOR_EVENTS } } }, { $group: { _id: null, stars: { $sum: "$signedAmount" } } }]),
    StarsLedgerEntry.aggregate([
      { $match: { accountUser: req.user._id, entryType: { $in: CREATOR_EVENTS }, createdAt: { $gt: withdrawalCutoff } } },
      { $lookup: { from: StarsLedgerEntry.collection.name, localField: "_id", foreignField: "reversalOf", as: "reversals" } },
      { $match: { reversals: { $size: 0 } } },
      { $group: { _id: null, stars: { $sum: "$signedAmount" } } },
    ]),
    PremiumMembership.find(automaticFilter).sort({ currentPeriodEnd: 1 }).limit(10).populate("user", "name username avatar").populate("premiumPublication", "title publishedSnapshot.metadata.title").lean(),
    PremiumMembership.aggregate([{ $match: automaticFilter }, { $group: { _id: null, count: { $sum: 1 }, starsPerMonth: { $sum: "$starsPerPeriod" } } }]),
  ]);
  const balance = wallet?.balance || 0;
  let sourceBalances = { bonus: Number(wallet?.bonusBalance || 0), purchased: Number(wallet?.purchasedBalance || 0), earned: Number(wallet?.earnedBalance || 0) };
  if (sourceBalances.bonus + sourceBalances.purchased + sourceBalances.earned !== balance) {
    const history = await StarsLedgerEntry.find({ accountUser: req.user._id }).sort({ createdAt: 1, _id: 1 }).lean();
    sourceBalances = rebuildWalletBuckets(history);
  }
  const bonusBalance = sourceBalances.bonus;
  const earnedBalance = sourceBalances.earned;
  const purchasedBalance = sourceBalances.purchased;
  const incomeStars = Math.max(0, Number(income[0]?.stars || 0));
  const { pendingIncomeStars, availableIncomeStars } = withdrawalBalances(earnedBalance, recentIncome[0]?.stars);
  const autoTotals = automaticSummary[0] || { count: 0, starsPerMonth: 0 };
  return sendResponse(res, 200, "Wallet fetched", { wallet: { balance, bonusBalance, purchasedBalance, earnedBalance, version: wallet?.version || 0, currency: "STARS", role: req.user.role, starsPerUsd, lifetimeIncomeStars: incomeStars, pendingIncomeStars, availableIncomeStars, withdrawalHoldHours: 24, withdrawalMinimumUsd: 20, balanceUsd: balance / starsPerUsd, incomeUsd: earnedBalance / starsPerUsd, pendingIncomeUsd: pendingIncomeStars / starsPerUsd, availableIncomeUsd: availableIncomeStars / starsPerUsd, automaticIncome: { activeSubscriptions: Number(autoTotals.count || 0), starsPerMonth: Number(autoTotals.starsPerMonth || 0), usdPerMonth: Number(autoTotals.starsPerMonth || 0) / starsPerUsd, items: automaticMemberships.map((membership) => ({ id: membership._id, subscriber: membership.user ? { name: membership.user.name, username: membership.user.username, avatar: membership.user.avatar || "" } : null, world: { id: membership.premiumPublication?._id, title: membership.premiumPublication?.title || membership.premiumPublication?.publishedSnapshot?.metadata?.title || "Premium World" }, stars: membership.starsPerPeriod, usd: membership.starsPerPeriod / starsPerUsd, nextRenewalAt: membership.currentPeriodEnd })) } } });
});

export const topUpWallet = asyncHandler(async (req, res) => {
  const key = idempotencyKey(req.body.idempotencyKey);
  const pack = TOPUP_PACKS[String(req.body.packUsd)];
  if (!pack) throw new ApiError(400, "Choose a valid top-up pack", "INVALID_TOPUP_PACK");
  const starsPerUsd = await getStarExchangeRate();
  const baseStars = Math.round(pack.usd * starsPerUsd);
  const totalStars = baseStars + pack.bonus;
  const result = await executeFinancialCommand(
    { user: req.user._id, commandType: "WALLET_TOPUP", idempotencyKey: key, requestFingerprint: fingerprint({ packUsd: pack.usd, baseStars, bonusStars: pack.bonus, starsPerUsd }) },
    async (session, command) => {
      const posted = await creditWallet({ user: req.user._id, amount: totalStars, bonusAmount: pack.bonus, entryType: "WALLET_TOPUP_CREDIT", entryRole: "USER_TOPUP", referenceType: "WALLET_TOPUP", referenceId: command._id, command, idempotencyKey: key, metadata: { usdAmount: pack.usd, starsPerUsd, baseStars, bonusStars: pack.bonus, temporaryCheckout: true } }, session);
      return { resultReference: posted.entry._id, wallet: safeWallet(posted.wallet), topUp: { usd: pack.usd, baseStars, bonusStars: pack.bonus, totalStars } };
    },
  );
  return sendResponse(res, 200, "Wallet topped up", result);
});

export const convertIncomeToCoins = asyncHandler(async (req, res) => {
  const key = idempotencyKey(req.body.idempotencyKey);
  const amount = positiveStars(req.body.starsAmount);
  const result = await executeFinancialCommand(
    { user: req.user._id, commandType: "CONVERT_INCOME_TO_COINS", idempotencyKey: key, requestFingerprint: fingerprint({ starsAmount: amount }) },
    async (session, command) => {
      let wallet = await Wallet.findOne({ user: req.user._id }).session(session);
      if (!wallet) throw new ApiError(422, "Wallet is unavailable", "WALLET_UNAVAILABLE");
      const classified = Number(wallet.bonusBalance || 0) + Number(wallet.purchasedBalance || 0) + Number(wallet.earnedBalance || 0);
      if (classified !== Number(wallet.balance || 0)) {
        const history = await StarsLedgerEntry.find({ accountUser: req.user._id }).sort({ createdAt: 1, _id: 1 }).session(session).lean();
        const rebuilt = rebuildWalletBuckets(history);
        wallet.bonusBalance = rebuilt.bonus;
        wallet.purchasedBalance = rebuilt.purchased;
        wallet.earnedBalance = rebuilt.earned;
        await wallet.save({ session });
      }
      const conversionCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentRows = await StarsLedgerEntry.aggregate([
        { $match: { accountUser: req.user._id, entryType: { $in: CREATOR_EVENTS }, createdAt: { $gt: conversionCutoff } } },
        { $lookup: { from: StarsLedgerEntry.collection.name, localField: "_id", foreignField: "reversalOf", as: "reversals" } },
        { $match: { reversals: { $size: 0 } } },
        { $group: { _id: null, stars: { $sum: "$signedAmount" } } },
      ]).session(session);
      const { availableIncomeStars } = withdrawalBalances(wallet.earnedBalance, recentRows[0]?.stars);
      if (amount > availableIncomeStars) throw new ApiError(422, "Income received during the last 24 hours cannot be converted yet", "INCOME_HOLD_ACTIVE");
      wallet = await Wallet.findOneAndUpdate(
        { _id: wallet._id, earnedBalance: { $gte: amount } },
        { $inc: { earnedBalance: -amount, purchasedBalance: amount, version: 1 } },
        { new: true, session, runValidators: true },
      );
      if (!wallet) throw new ApiError(422, "Your creator income balance is too low", "INSUFFICIENT_CREATOR_INCOME");
      const metadata = { oneWay: true, source: "EARNED", destination: "PURCHASED", starsAmount: amount };
      const [debit, credit] = await StarsLedgerEntry.create([
        { accountUser: req.user._id, entryType: "INCOME_CONVERSION_DEBIT", entryRole: "INCOME_CONVERSION_SOURCE", direction: "DEBIT", starsAmount: amount, signedAmount: -amount, balanceAfter: wallet.balance, referenceType: "INCOME_CONVERSION", referenceId: String(command._id), commandId: command._id, idempotencyKey: key, metadata: { ...metadata, bucketSpend: { bonus: 0, purchased: 0, earned: amount } } },
        { accountUser: req.user._id, entryType: "INCOME_CONVERSION_CREDIT", entryRole: "INCOME_CONVERSION_DESTINATION", direction: "CREDIT", starsAmount: amount, signedAmount: amount, balanceAfter: wallet.balance, referenceType: "INCOME_CONVERSION", referenceId: String(command._id), commandId: command._id, idempotencyKey: key, parentEntry: null, reversalOf: null, metadata: { ...metadata, bucketCredit: { bonus: 0, purchased: amount, earned: 0 } } },
      ], { session, ordered: true });
      await Wallet.updateOne({ _id: wallet._id }, { $set: { lastLedgerEntry: credit._id } }, { session });
      return { resultReference: credit._id, wallet: safeWallet(wallet), conversion: { starsAmount: amount, debitLedgerEntry: debit._id, creditLedgerEntry: credit._id } };
    },
  );
  return sendResponse(res, 200, "Creator income converted to Coins", result);
});

export const getLedger = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const filter = { accountUser: req.user._id };
  const [rows, total] = await Promise.all([StarsLedgerEntry.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate("counterpartyUser", "name username avatar isVerified role").populate("publication", "title kind planet publishedSnapshot.metadata.title").lean(), StarsLedgerEntry.countDocuments(filter)]);
  return sendResponse(res, 200, "Ledger fetched", { items: rows.map((item) => ({ id: item._id, event: item.entryType, starsChange: item.signedAmount, reference: { type: item.referenceType, id: item.referenceId }, publication: safePublication(item.publication), metadata: item.metadata?.giftName ? { giftName: item.metadata.giftName } : undefined, counterparty: item.counterpartyUser ? { id: item.counterpartyUser._id, name: item.counterpartyUser.name, username: item.counterpartyUser.username, avatar: item.counterpartyUser.avatar || "", verified: Boolean(item.counterpartyUser.isVerified), role: item.counterpartyUser.role } : null, createdAt: item.createdAt })), pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
});

export const getWorldEntitlements = asyncHandler(async (req, res) => {
  const rows = await WorldEntitlement.find({ user: req.user._id }).populate({ path: "publication", select: "title coverMedia planet pricing status creator", populate: { path: "creator", select: "name username avatar" } }).sort({ grantedAt: -1 }).lean();
  return sendResponse(res, 200, "World entitlement history fetched", { items: rows.map((item) => ({ id: item._id, publication: item.publication, status: item.status, purchasedStars: item.purchasedStars, grantedAt: item.grantedAt, revokedAt: item.revokedAt, refundedAt: item.refundedAt })) });
});
export const effectiveMembershipStatus = (membership, now = new Date()) => ["ACTIVE", "CANCEL_AT_PERIOD_END"].includes(membership.status) && new Date(membership.currentPeriodEnd) <= now ? "EXPIRED" : membership.status;
export const getMemberships = asyncHandler(async (req, res) => {
  const rows = await PremiumMembership.find({ user: req.user._id }).populate("premiumPublication", "title coverMedia planet pricing status").populate("creator", "name username avatar").sort({ createdAt: -1 }).lean();
  return sendResponse(res, 200, "Memberships fetched", { items: rows.map((item) => ({ id: item._id, creator: item.creator, premiumPublication: item.premiumPublication, status: effectiveMembershipStatus(item), storedStatus: item.status, starsPerPeriod: item.starsPerPeriod, periodUnit: item.periodUnit, currentPeriodStart: item.currentPeriodStart, currentPeriodEnd: item.currentPeriodEnd, cancelAtPeriodEnd: item.cancelAtPeriodEnd, autoRenew: item.status === "ACTIVE" && !item.cancelAtPeriodEnd, canceledAt: item.canceledAt, endedAt: item.endedAt })) });
});
