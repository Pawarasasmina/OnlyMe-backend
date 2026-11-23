import ApiError from "../utils/ApiError.js";
import { permissionsForRole } from "../services/adminPermissionService.js";

export const ADMIN_ROLES = Object.freeze({ MAIN_ADMIN: "MAIN_ADMIN", MODERATOR: "MODERATOR", FINANCE: "FINANCE" });
export const effectiveAdminRole = (user) => user?.role === "admin" ? (user.adminRole || ADMIN_ROLES.MAIN_ADMIN) : null;

export function requireAdminRole(...allowed) {
  return (req, _res, next) => {
    const role = effectiveAdminRole(req.user);
    if (!role || !allowed.includes(role)) return next(new ApiError(403, "Your admin role cannot access this area"));
    req.adminRole = role;
    return next();
  };
}

export function requireAdminPermission(permission) {
  return async (req, _res, next) => {
    try {
      const role = effectiveAdminRole(req.user);
      if (!role) return next(new ApiError(403, "Administrator access is required"));
      if (role === ADMIN_ROLES.MAIN_ADMIN) { req.adminRole = role; return next(); }
      const permissions = await permissionsForRole(role);
      if (!permissions.includes(permission)) return next(new ApiError(403, "Your role does not have permission to use this feature"));
      req.adminRole = role;
      return next();
    } catch (error) { return next(error); }
  };
}
