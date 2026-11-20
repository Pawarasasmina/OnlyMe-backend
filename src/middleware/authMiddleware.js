import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { expireVerifiedCreator, synchronizeIdentityBadge } from "../services/verifiedCreatorService.js";

export const protect = asyncHandler(async (req, _res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : req.cookies?.accessToken;

  if (!token) {
    throw new ApiError(401, "Authentication token is required");
  }

  let decoded;

  try {
    decoded = jwt.verify(token, env.accessSecret);
  } catch {
    throw new ApiError(401, "Invalid or expired authentication token");
  }

  const user = await User.findById(decoded.sub).select("+accountType");

  if (!user) {
    throw new ApiError(401, "User not found");
  }

  if ((decoded.authVersion || 0) !== (user.authVersion || 0)) throw new ApiError(401, "Please log in again");
  if (user.status !== "active") {
    throw new ApiError(403, "This account is suspended");
  }
  if (user.loginRestrictedUntil && user.loginRestrictedUntil > new Date()) {
    throw new ApiError(403, `Account access is restricted until ${user.loginRestrictedUntil.toISOString()}`);
  }
  const adminSecuritySelfService = req.originalUrl?.includes("/admin/security/2fa");
  if (user.role === "admin" && user.adminReadOnly && !adminSecuritySelfService && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    throw new ApiError(403, "This is a read-only administrator test account", "ADMIN_READ_ONLY");
  }

  await synchronizeIdentityBadge(user);
  if (user.isVerified && user.creatorApprovalStatus === "approved") {
    const expired = await expireVerifiedCreator(user._id);
    if (expired) user.isVerified = false;
  }

  req.user = user;
  next();
});

export const optionalProtect = asyncHandler(async (req, _res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : req.cookies?.accessToken;
  if (!token) return next();

  let decoded;
  try {
    decoded = jwt.verify(token, env.accessSecret);
  } catch {
    throw new ApiError(401, "Invalid or expired authentication token");
  }

  const user = await User.findById(decoded.sub).select("+accountType");
  if (!user) throw new ApiError(401, "User not found");
  if ((decoded.authVersion || 0) !== (user.authVersion || 0)) throw new ApiError(401, "Please log in again");
  if (user.status !== "active") throw new ApiError(403, "This account is suspended");
  if (user.loginRestrictedUntil && user.loginRestrictedUntil > new Date()) throw new ApiError(403, `Account access is restricted until ${user.loginRestrictedUntil.toISOString()}`);
  const adminSecuritySelfService = req.originalUrl?.includes("/admin/security/2fa");
  if (user.role === "admin" && user.adminReadOnly && !adminSecuritySelfService && !["GET", "HEAD", "OPTIONS"].includes(req.method)) throw new ApiError(403, "This is a read-only administrator test account", "ADMIN_READ_ONLY");
  req.user = user;
  return next();
});
