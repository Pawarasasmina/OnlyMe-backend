import AdminProfile from "../models/AdminProfile.js";
import User from "../models/User.js";
import AdminAuditEvent from "../models/AdminAuditEvent.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { createTotpSecret, verifyTotp } from "../utils/totp.js";
import { effectiveAdminRole } from "../middleware/adminPermissionMiddleware.js";

export const getTwoFactorStatus = asyncHandler(async (req, res) => sendResponse(res, 200, "Two-factor status fetched", { enabled: Boolean(req.user.adminTwoFactorEnabled) }));
export const beginTwoFactorSetup = asyncHandler(async (req, res) => { const secret = createTotpSecret(); await AdminProfile.findOneAndUpdate({ user: req.user._id }, { $set: { twoFactorPendingSecret: secret }, $setOnInsert: { user: req.user._id } }, { upsert: true }); const issuer = "OnlyMe Admin"; const account = encodeURIComponent(req.user.email); const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${account}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`; return sendResponse(res, 200, "Two-factor setup started", { secret, uri }); });
export const confirmTwoFactorSetup = asyncHandler(async (req, res) => { const profile = await AdminProfile.findOne({ user: req.user._id }).select("+twoFactorPendingSecret +twoFactorSecret"); if (!profile?.twoFactorPendingSecret || !verifyTotp(profile.twoFactorPendingSecret, req.body.code)) throw new ApiError(400, "The authenticator code is invalid"); profile.twoFactorSecret = profile.twoFactorPendingSecret; profile.twoFactorPendingSecret = ""; profile.twoFactorEnabledAt = new Date(); await profile.save(); await User.updateOne({ _id: req.user._id }, { $set: { adminTwoFactorEnabled: true }, $inc: { authVersion: 1 } }); await AdminAuditEvent.create({ actor: req.user._id, actorRole: effectiveAdminRole(req.user), action: "ADMIN_2FA_ENABLED", targetType: "ADMIN_ACCOUNT", targetId: String(req.user._id), reason: "Mandatory administrator two-factor authentication enrolled" }); return sendResponse(res, 200, "Two-factor authentication enabled", { enabled: true, sessionsRevoked: true }); });

export const disableTwoFactor = asyncHandler(async (req, res) => {
  const [user, profile] = await Promise.all([
    User.findById(req.user._id).select("+password adminTwoFactorEnabled authVersion"),
    AdminProfile.findOne({ user: req.user._id }).select("+twoFactorSecret +twoFactorPendingSecret"),
  ]);
  if (!user?.adminTwoFactorEnabled || !profile?.twoFactorSecret) throw new ApiError(409, "Two-factor authentication is not enabled");
  if (!req.body.currentPassword || !(await user.comparePassword(req.body.currentPassword))) throw new ApiError(401, "Your current password is incorrect");
  if (!verifyTotp(profile.twoFactorSecret, req.body.code)) throw new ApiError(400, "The authenticator code is invalid");

  profile.twoFactorSecret = "";
  profile.twoFactorPendingSecret = "";
  profile.twoFactorEnabledAt = null;
  user.adminTwoFactorEnabled = false;
  user.authVersion = Number(user.authVersion || 0) + 1;
  await Promise.all([profile.save(), user.save()]);
  await AdminAuditEvent.create({
    actor: req.user._id,
    actorRole: effectiveAdminRole(req.user),
    action: "ADMIN_2FA_DISABLED",
    targetType: "ADMIN_ACCOUNT",
    targetId: String(req.user._id),
    reason: "Administrator disabled two-factor authentication after password and authenticator verification",
    before: { enabled: true },
    after: { enabled: false },
  });
  return sendResponse(res, 200, "Two-factor authentication disabled", { enabled: false, sessionsRevoked: true });
});
