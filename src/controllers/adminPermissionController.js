import AdminRolePermission from "../models/AdminRolePermission.js";
import AdminAuditEvent from "../models/AdminAuditEvent.js";
import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { effectiveAdminRole } from "../middleware/adminPermissionMiddleware.js";
import { ADMIN_PERMISSION_CATALOG, ADMIN_PERMISSION_KEYS, DEFAULT_ADMIN_ROLE_PERMISSIONS, REQUIRED_ADMIN_ROLE_PERMISSIONS } from "../constants/adminPermissionConstants.js";
import { adminAccessPayload, permissionsForRole, permissionsWithRequired } from "../services/adminPermissionService.js";

const configurableRoles = ["MODERATOR", "FINANCE"];

export const getMyAdminAccess = asyncHandler(async (req, res) => sendResponse(res, 200, "Admin access fetched", await adminAccessPayload(effectiveAdminRole(req.user))));

export const getAdminRolePolicies = asyncHandler(async (_req, res) => {
  const policies = Object.fromEntries(await Promise.all(["MAIN_ADMIN", ...configurableRoles].map(async (role) => [role, await permissionsForRole(role)])));
  return sendResponse(res, 200, "Admin role policies fetched", { catalog: ADMIN_PERMISSION_CATALOG, policies, defaults: DEFAULT_ADMIN_ROLE_PERMISSIONS, required: REQUIRED_ADMIN_ROLE_PERMISSIONS });
});

export const updateAdminRolePolicy = asyncHandler(async (req, res) => {
  const role = String(req.params.role || "").toUpperCase();
  if (!configurableRoles.includes(role)) throw new ApiError(400, "Only Moderator and Finance role access can be customized");
  if (!Array.isArray(req.body.permissions)) throw new ApiError(400, "Choose the permissions for this role");
  const unknown = req.body.permissions.map(String).filter((key) => !ADMIN_PERMISSION_KEYS.includes(key));
  if (unknown.length) throw new ApiError(400, `Unknown permission: ${unknown[0]}`);
  const permissions = permissionsWithRequired(role, req.body.permissions);
  const before = await permissionsForRole(role);
  await AdminRolePermission.findOneAndUpdate({ adminRole: role }, { $set: { permissions, updatedBy: req.user._id } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  await User.updateMany({ role: "admin", adminRole: role }, { $inc: { authVersion: 1 } });
  await AdminAuditEvent.create({ actor: req.user._id, actorRole: "MAIN_ADMIN", action: "ADMIN_ROLE_PERMISSIONS_UPDATED", targetType: "ADMIN_ROLE", targetId: role, reason: String(req.body.reason || "Role access updated").trim().slice(0, 500), before: { permissions: before }, after: { permissions } });
  req.app.get("io")?.in(`admin-role:${role}`).disconnectSockets(true);
  return sendResponse(res, 200, "Role permissions updated", { role, permissions });
});
