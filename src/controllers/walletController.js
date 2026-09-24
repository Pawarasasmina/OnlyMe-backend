import Wallet from "../models/Wallet.js";
import StarsLedgerEntry from "../models/StarsLedgerEntry.js";
import WorldEntitlement from "../models/WorldEntitlement.js";
import PremiumMembership from "../models/PremiumMembership.js";
import { getStarExchangeRate } from "../services/starExchangeService.js";
import { executeFinancialCommand } from "../services/financialCommandService.js";
import { creditWallet, safeWallet } from "../services/walletLedgerService.js";
import { fingerprint, idempotencyKey } from "../validators/financialValidator.js";
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
const CREATOR_EVENTS = ["WORLD_CREATOR_EARNING", "PREMIUM_CREATOR_EARNING", "DREAM_CREATOR_EARNING", "CHAT_GIFT_EARNING", "DA_CREATOR_EARNING", "CALL_CREATOR_EARNING", "CREATOR_EARNING_REVERSAL"];
const safePublication = (item) => item ? { id: item._id, title: item.title || item.publishedSnapshot?.metadata?.title || "", kind: item.kind, planet: item.planet || null } : null;

export const getWallet = asyncHandler(async (req, res) => {
  const [wallet, starsPerUsd, income] = await Promise.all([
    Wallet.findOne({ user: req.user._id }).lean(),
    getStarExchangeRate(),
    StarsLedgerEntry.aggregate([{ $match: { accountUser: req.user._id, entryType: { $in: CREATOR_EVENTS } } }, { $group: { _id: null, stars: { $sum: "$signedAmount" } } }]),
  ]);
  const balance = wallet?.balance || 0;
  const incomeStars = Math.max(0, Number(income[0]?.stars || 0));
  return sendResponse(res, 200, "Wallet fetched", { wallet: { balance, bonusBalance: Number(wallet?.bonusBalance || 0), version: wallet?.version || 0, currency: "STARS", role: req.user.role, starsPerUsd, incomeStars, balanceUsd: balance / starsPerUsd, incomeUsd: incomeStars / starsPerUsd } });
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
