import ApiError from "../utils/ApiError.js";
import LegalHold from "../models/LegalHold.js";
export function requirePostingAccess(req, _res, next) {
  if (req.user?.postingRestrictedUntil && req.user.postingRestrictedUntil > new Date()) return next(new ApiError(403, `Posting is restricted until ${req.user.postingRestrictedUntil.toISOString()}`));
  return next();
}
export function requireSellingAccess(req, _res, next) {
  if (req.user?.sellingRestrictedUntil && req.user.sellingRestrictedUntil > new Date()) return next(new ApiError(403, `Selling and payouts are restricted until ${req.user.sellingRestrictedUntil.toISOString()}`));
  return next();
}
export async function requireNoContentHold(req, _res, next) {
  try { if (await LegalHold.exists({ targetType: "CONTENT", targetId: String(req.params.id), active: true })) return next(new ApiError(423, "This content is currently subject to a deletion hold", "LEGAL_HOLD_ACTIVE")); return next(); } catch (error) { return next(error); }
}
