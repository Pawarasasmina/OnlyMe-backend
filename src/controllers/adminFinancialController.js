import mongoose from "mongoose";
import User from "../models/User.js";
import Wallet from "../models/Wallet.js";
import StarsLedgerEntry from "../models/StarsLedgerEntry.js";
import Transaction from "../models/Transaction.js";
import { executeFinancialCommand } from "../services/financialCommandService.js";
import { creditWallet, safeWallet } from "../services/walletLedgerService.js";
import { activateWalletLedger } from "../services/walletAdministrationService.js";
import { refundWorld, refundPremium } from "../services/refundService.js";
import { positiveStars, idempotencyKey, requiredReason, fingerprint } from "../validators/financialValidator.js";
import { env } from "../config/env.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

const objectId = (value) => {
  if (!mongoose.isObjectIdOrHexString(value)) throw new ApiError(400, "A valid financial record identifier is required", "INVALID_FINANCIAL_ID");
  return value;
};

export const creditStars = asyncHandler(async (req, res) => {
  if (!env.enableAdminStarCredits) throw new ApiError(403, "Admin Stars credits are disabled", "ADMIN_CREDITS_DISABLED");
  const target = await User.findById(objectId(req.params.userId)).select("_id role status");
  if (!target) throw new ApiError(404, "User not found", "USER_NOT_FOUND");
  if (target.role !== "fan") throw new ApiError(400, "Stars can only be added to fan Wallets", "FAN_WALLET_REQUIRED");
  if (target.status !== "active") throw new ApiError(409, "The selected fan account is not active", "FAN_ACCOUNT_INACTIVE");
  const amount = positiveStars(req.body.starsAmount);
  const reason = requiredReason(req.body.reason);
  const key = idempotencyKey(req.body.idempotencyKey);
  const resetLegacyWallet = req.body.resetLegacyWallet === true;
  const result = await executeFinancialCommand({ user: req.user._id, commandType: "ADMIN_CREDIT", idempotencyKey: key, requestFingerprint: fingerprint({ target: String(target._id), amount, reason, resetLegacyWallet }) }, async (session, command) => {
    const existingWallet = await Wallet.findOne({ user: target._id }).session(session);
    const requiresReset = Boolean(existingWallet && (existingWallet.currency !== "STARS" || !existingWallet.ledgerActivatedAt || existingWallet.reconciliationStatus !== "MATCHED"));
    if (requiresReset && !resetLegacyWallet) throw new ApiError(409, "Legacy Wallet reset confirmation is required", "WALLET_RESET_CONFIRMATION_REQUIRED");
    let reset = null;
    if (requiresReset) reset = await activateWalletLedger({ user: target._id, openingBalance: 0, reason: `Legacy Wallet reset before admin top-up: ${reason}`, admin: req.user._id, command, idempotencyKey: key }, session);
    const posted = await creditWallet({ user: target._id, amount, entryType: "CREDIT_ADMIN", entryRole: "ADMIN_CREDIT", referenceType: "ADMIN_CREDIT", referenceId: command._id, command, idempotencyKey: key, counterpartyUser: req.user._id, metadata: { reason, adminUser: String(req.user._id), legacyWalletReset: Boolean(reset), previousBalance: reset?.previous.balance, previousCurrency: reset?.previous.currency } }, session);
    return { resultReference: posted.entry._id, wallet: safeWallet(posted.wallet), credit: { starsAmount: amount, createdAt: posted.entry.createdAt }, legacyReset: reset ? { previousBalance: reset.previous.balance, previousCurrency: reset.previous.currency } : null };
  });
  return sendResponse(res, 200, "Stars credited", result);
});

export const listFanWallets = asyncHandler(async (req, res) => {
  const search = String(req.query.search || "").trim();
  const filter = { role: "fan", ...(search ? { $or: ["name", "username", "email"].map((field) => ({ [field]: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } })) } : {}) };
  const fans = await User.find(filter).select("name username email avatar status").sort({ createdAt: -1 }).limit(200).lean();
  const userIds = fans.map((fan) => fan._id);
  const [wallets, ledgerTotals] = await Promise.all([
    Wallet.find({ user: { $in: userIds } }).lean(),
    StarsLedgerEntry.aggregate([{ $match: { accountUser: { $in: userIds } } }, { $group: { _id: "$accountUser", balance: { $sum: "$signedAmount" }, entries: { $sum: 1 } } }]),
  ]);
  const legacyTransactions = await Transaction.find({ wallet: { $in: wallets.map((wallet) => wallet._id) } }).sort({ createdAt: -1 }).limit(1000).lean();
  const walletByUser = new Map(wallets.map((wallet) => [String(wallet.user), wallet]));
  const ledgerByUser = new Map(ledgerTotals.map((row) => [String(row._id), row]));
  const legacyByWallet = new Map();
  for (const transaction of legacyTransactions) legacyByWallet.set(String(transaction.wallet), [...(legacyByWallet.get(String(transaction.wallet)) || []), transaction]);
  const items = fans.map((fan) => {
    const wallet = walletByUser.get(String(fan._id));
    const ledger = ledgerByUser.get(String(fan._id));
    const walletBalance = Number(wallet?.balance || 0);
    const ledgerBalance = Number(ledger?.balance || 0);
    const legacy = legacyByWallet.get(String(wallet?._id)) || [];
    const legacyProjection = legacy.filter((item) => item.status === "completed").reduce((total, item) => total + (item.type === "debit" ? -1 : 1) * Math.abs(Number(item.amount) || 0), 0);
    const reconciliationStatus = !wallet ? "NOT_CREATED" : wallet.currency !== "STARS" || !wallet.ledgerActivatedAt ? "NOT_ACTIVATED" : walletBalance !== ledgerBalance ? "DRIFT" : wallet.reconciliationStatus === "MATCHED" ? "MATCHED" : wallet.reconciliationStatus || "BLOCKED";
    return { id: fan._id, name: fan.name, username: fan.username, email: fan.email, avatar: fan.avatar || "", status: fan.status, wallet: { exists: Boolean(wallet), balance: walletBalance, currency: wallet?.currency || "STARS", version: wallet?.version || 0, ledgerActivated: Boolean(wallet?.ledgerActivatedAt), ledgerActivatedAt: wallet?.ledgerActivatedAt || null, reconciliationStatus, ledgerBalance, ledgerEntries: ledger?.entries || 0, legacyProjection, legacyDifference: walletBalance - legacyProjection, legacyTransactions: legacy.slice(0, 20).map((item) => ({ id: item._id, amount: item.amount, type: item.type, status: item.status, description: item.description, createdAt: item.createdAt })) } };
  });
  return sendResponse(res, 200, "Fan Wallets fetched", { items });
});

export const activateFanWallet = asyncHandler(async (req, res) => {
  if (!env.enableAdminStarCredits) throw new ApiError(403, "Admin Stars credits are disabled", "ADMIN_CREDITS_DISABLED");
  const target = await User.findById(objectId(req.params.userId)).select("_id role status");
  if (!target || target.role !== "fan") throw new ApiError(404, "Fan not found", "USER_NOT_FOUND");
  const openingBalance = Number(req.body.openingBalance);
  if (!Number.isSafeInteger(openingBalance) || openingBalance < 0) throw new ApiError(400, "Opening balance must be a non-negative integer", "INVALID_OPENING_BALANCE");
  const reason = requiredReason(req.body.reason);
  const key = idempotencyKey(req.body.idempotencyKey);
  const result = await executeFinancialCommand({ user: req.user._id, commandType: "ACTIVATE_WALLET", idempotencyKey: key, requestFingerprint: fingerprint({ target: String(target._id), openingBalance, reason }) }, async (session, command) => {
    const activated = await activateWalletLedger({ user: target._id, openingBalance, reason, admin: req.user._id, command, idempotencyKey: key }, session);
    return { resultReference: activated.entry?._id || activated.wallet._id, wallet: safeWallet(activated.wallet), activation: { openingBalance, previousBalance: activated.previous.balance, previousCurrency: activated.previous.currency, activatedAt: activated.wallet.ledgerActivatedAt } };
  });
  return sendResponse(res, 200, "Wallet ledger activated", result);
});

export const refundWorldEntitlement = asyncHandler(async (req, res) => sendResponse(res, 200, "World purchase refunded", await refundWorld({ admin: req.user, entitlementId: objectId(req.params.id), key: req.body.idempotencyKey, reason: req.body.reason })));
export const refundPremiumMembership = asyncHandler(async (req, res) => sendResponse(res, 200, "Premium period refunded", await refundPremium({ admin: req.user, membershipId: objectId(req.params.id), key: req.body.idempotencyKey, reason: req.body.reason })));
