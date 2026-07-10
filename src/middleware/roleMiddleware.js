import ApiError from "../utils/ApiError.js";

export function authorize(...allowedRoles) {
  return (req, _res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      next(new ApiError(403, "You are not authorized to access this resource"));
      return;
    }

    next();
  };
}
