import ApiError from "../utils/ApiError.js";

export function requireApprovedCreator(req, _res, next) {
  if (req.user?.role === "creator" && req.user.creatorApprovalStatus !== "approved") {
    next(new ApiError(403, "Your creator application must be approved by an admin"));
    return;
  }

  next();
}
