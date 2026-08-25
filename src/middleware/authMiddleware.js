import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { expireVerifiedCreator } from "../services/verifiedCreatorService.js";

export const protect = asyncHandler(async (req, _res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;

  if (!token) {
    throw new ApiError(401, "Authentication token is required");
  }

  let decoded;

  try {
    decoded = jwt.verify(token, env.accessSecret);
  } catch {
    throw new ApiError(401, "Invalid or expired authentication token");
  }

  const user = await User.findById(decoded.sub);

  if (!user) {
    throw new ApiError(401, "User not found");
  }

  if (user.status !== "active") {
    throw new ApiError(403, "This account is suspended");
  }
  if (user.loginRestrictedUntil && user.loginRestrictedUntil > new Date()) {
    throw new ApiError(403, `Account access is restricted until ${user.loginRestrictedUntil.toISOString()}`);
  }

  if (user.isVerified && user.creatorApprovalStatus === "approved") {
    const expired = await expireVerifiedCreator(user._id);
    if (expired) user.isVerified = false;
  }

  req.user = user;
  next();
});

export const optionalProtect = asyncHandler(async (req, _res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
  if (!token) return next();

  let decoded;
  try {
    decoded = jwt.verify(token, env.accessSecret);
  } catch {
    throw new ApiError(401, "Invalid or expired authentication token");
  }

  const user = await User.findById(decoded.sub);
  if (!user) throw new ApiError(401, "User not found");
  if (user.status !== "active") throw new ApiError(403, "This account is suspended");
  if (user.loginRestrictedUntil && user.loginRestrictedUntil > new Date()) throw new ApiError(403, `Account access is restricted until ${user.loginRestrictedUntil.toISOString()}`);
  req.user = user;
  return next();
});
