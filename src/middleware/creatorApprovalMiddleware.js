import ApiError from "../utils/ApiError.js";
import { hasCreatorAccess } from "../utils/accountCapabilities.js";

export function requireApprovedCreator(req, _res, next) {
  if (!hasCreatorAccess(req.user)) {
    next(new ApiError(403, "Your creator application must be approved by an admin"));
    return;
  }

  next();
}
