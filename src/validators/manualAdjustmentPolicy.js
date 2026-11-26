import ApiError from "../utils/ApiError.js";

export function assertManualAdjustmentAccess(user, settings) {
  if (user?.role !== "admin" || user.adminRole !== "FINANCE" || user.adminReadOnly) throw new ApiError(403, "Only Finance can make manual adjustments", "FINANCE_REQUIRED");
  if (settings.nodeEnv === "production" || !settings.enableAdminStarCredits) throw new ApiError(403, "Manual adjustments are disabled in production", "ADMIN_CREDITS_DISABLED");
}
export function assertManualAdjustmentTarget(target) {
  if (target.accountType !== "TEST") throw new ApiError(403, "Manual adjustments are restricted to TEST accounts", "TEST_ACCOUNT_REQUIRED");
}
