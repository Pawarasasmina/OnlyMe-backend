import ApiError from "../utils/ApiError.js";

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
