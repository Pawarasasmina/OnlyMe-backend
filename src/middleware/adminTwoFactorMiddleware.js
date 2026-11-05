import ApiError from "../utils/ApiError.js";
export function requireAdminTwoFactor(req, _res, next) { if (req.user?.role === "admin" && !req.user.adminTwoFactorEnabled) return next(new ApiError(403, "Set up two-factor authentication before using the admin console", "ADMIN_2FA_SETUP_REQUIRED")); return next(); }
