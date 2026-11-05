import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { createTotpSecret, verifyTotp } from "../utils/totp.js";

function ensureConsumer(user) {
  if (user.role === "admin") throw new ApiError(403, "Administrators must use the administrator security setup");
}

export const getAccountTwoFactorStatus = asyncHandler(async (req, res) => {
  ensureConsumer(req.user);
  return sendResponse(res, 200, "Two-factor status fetched", { enabled: Boolean(req.user.twoFactorEnabled) });
});

export const beginAccountTwoFactorSetup = asyncHandler(async (req, res) => {
  ensureConsumer(req.user);
  if (req.user.twoFactorEnabled) throw new ApiError(409, "Two-factor authentication is already enabled");
  const secret = createTotpSecret();
  await User.updateOne({ _id: req.user._id }, { $set: { twoFactorPendingSecret: secret } });
  const issuer = "OnlyMe";
  const account = encodeURIComponent(req.user.email);
  const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${account}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
  return sendResponse(res, 200, "Two-factor setup started", { secret, uri });
});

export const confirmAccountTwoFactorSetup = asyncHandler(async (req, res) => {
  ensureConsumer(req.user);
  const user = await User.findById(req.user._id).select("+twoFactorPendingSecret +twoFactorSecret");
  if (!user?.twoFactorPendingSecret || !verifyTotp(user.twoFactorPendingSecret, req.body.code)) throw new ApiError(400, "The authenticator code is invalid");
  user.twoFactorSecret = user.twoFactorPendingSecret;
  user.twoFactorPendingSecret = "";
  user.twoFactorEnabled = true;
  user.twoFactorEnabledAt = new Date();
  user.authVersion += 1;
  await user.save();
  return sendResponse(res, 200, "Two-factor authentication enabled", { enabled: true, sessionsRevoked: true });
});

export const disableAccountTwoFactor = asyncHandler(async (req, res) => {
  ensureConsumer(req.user);
  const user = await User.findById(req.user._id).select("+password +twoFactorSecret");
  if (!user?.twoFactorEnabled) throw new ApiError(409, "Two-factor authentication is not enabled");
  if (!req.body.currentPassword || !(await user.comparePassword(req.body.currentPassword))) throw new ApiError(401, "Your current password is incorrect");
  if (!verifyTotp(user.twoFactorSecret, req.body.code)) throw new ApiError(400, "The authenticator code is invalid");
  user.twoFactorEnabled = false;
  user.twoFactorSecret = "";
  user.twoFactorPendingSecret = "";
  user.twoFactorEnabledAt = null;
  user.authVersion += 1;
  await user.save();
  return sendResponse(res, 200, "Two-factor authentication disabled", { enabled: false, sessionsRevoked: true });
});
