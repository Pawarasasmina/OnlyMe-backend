import mongoose from "mongoose";
import User from "../models/User.js";
import { executeFinancialCommand } from "../services/financialCommandService.js";
import { creditWallet, safeWallet } from "../services/walletLedgerService.js";
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
  const target = await User.findById(objectId(req.params.userId)).select("_id status");
  if (!target) throw new ApiError(404, "User not found", "USER_NOT_FOUND");
  const amount = positiveStars(req.body.starsAmount);
  const reason = requiredReason(req.body.reason);
  const key = idempotencyKey(req.body.idempotencyKey);
  const result = await executeFinancialCommand({ user: req.user._id, commandType: "ADMIN_CREDIT", idempotencyKey: key, requestFingerprint: fingerprint({ target: String(target._id), amount, reason }) }, async (session, command) => {
    const posted = await creditWallet({ user: target._id, amount, entryType: "CREDIT_ADMIN", entryRole: "ADMIN_CREDIT", referenceType: "ADMIN_CREDIT", referenceId: command._id, command, idempotencyKey: key, counterpartyUser: req.user._id, metadata: { reason, adminUser: String(req.user._id) } }, session);
    return { resultReference: posted.entry._id, wallet: safeWallet(posted.wallet), credit: { starsAmount: amount, createdAt: posted.entry.createdAt } };
  });
  return sendResponse(res, 200, "Stars credited", result);
});

export const refundWorldEntitlement = asyncHandler(async (req, res) => sendResponse(res, 200, "World purchase refunded", await refundWorld({ admin: req.user, entitlementId: objectId(req.params.id), key: req.body.idempotencyKey, reason: req.body.reason })));
export const refundPremiumMembership = asyncHandler(async (req, res) => sendResponse(res, 200, "Premium period refunded", await refundPremium({ admin: req.user, membershipId: objectId(req.params.id), key: req.body.idempotencyKey, reason: req.body.reason })));
