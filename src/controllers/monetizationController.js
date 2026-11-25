import PlatformSetting from "../models/PlatformSetting.js";
import AdminAuditEvent from "../models/AdminAuditEvent.js";
import { monetizationSummary, completeMonetizationEligibility, getMonetizationPolicy, validateMonetizationPolicy, MONETIZATION_POLICY_KEY } from "../services/monetizationService.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { effectiveAdminRole } from "../middleware/adminPermissionMiddleware.js";
export const getMonetization = asyncHandler(async (req, res) => sendResponse(res, 200, "Monetization fetched", await monetizationSummary(req.user)));
export const updateMonetization = asyncHandler(async (req, res) => sendResponse(res, 200, "Monetization updated", await completeMonetizationEligibility(req.user, req.body)));
export const getMonetizationPolicyAdmin = asyncHandler(async (_req, res) => sendResponse(res, 200, "Monetization policy fetched", await getMonetizationPolicy()));
export const updateMonetizationPolicyAdmin = asyncHandler(async (req, res) => {
  const before = await getMonetizationPolicy();
  const value = validateMonetizationPolicy(req.body);
  await PlatformSetting.findOneAndUpdate({ key: MONETIZATION_POLICY_KEY }, { $set: { value, updatedBy: req.user._id } }, { upsert: true, runValidators: true });
  await AdminAuditEvent.create({ actor: req.user._id, actorRole: effectiveAdminRole(req.user), action: "COUNTRY_FEATURE_POLICY_UPDATED", targetType: "PLATFORM_SETTING", targetId: MONETIZATION_POLICY_KEY, reason: String(req.body.reason || "Country feature availability updated").trim(), before, after: value, metadata: { source: "admin-financial-policy" } });
  return sendResponse(res, 200, "Monetization policy updated", value);
});
