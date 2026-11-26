import AdminRolePermission from "../models/AdminRolePermission.js";
import { ADMIN_PERMISSION_CATALOG, ADMIN_PERMISSION_KEYS, DEFAULT_ADMIN_ROLE_PERMISSIONS, REQUIRED_ADMIN_ROLE_PERMISSIONS } from "../constants/adminPermissionConstants.js";

export const cleanAdminPermissions = (values) => [...new Set(Array.isArray(values) ? values.map(String) : [])].filter((key) => ADMIN_PERMISSION_KEYS.includes(key));
export const permissionsWithRequired = (role, values) => cleanAdminPermissions([...(REQUIRED_ADMIN_ROLE_PERMISSIONS[role] || []), ...(values || [])]);

export async function permissionsForRole(role) {
  if (role === "MAIN_ADMIN") return [...ADMIN_PERMISSION_KEYS];
  const saved = await AdminRolePermission.findOne({ adminRole: role }).lean();
  return saved ? permissionsWithRequired(role, saved.permissions) : [...(DEFAULT_ADMIN_ROLE_PERMISSIONS[role] || [])];
}

export async function adminAccessPayload(role) {
  const permissions = await permissionsForRole(role);
  return { role, permissions, catalog: ADMIN_PERMISSION_CATALOG };
}
