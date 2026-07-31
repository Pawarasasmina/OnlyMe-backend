import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const protect = asyncHandler(async (req, _res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;

  if (!token) {
    throw new ApiError(401, "Authentication token is required");
  }

  let decoded;

  try {
    decoded = jwt.verify(token, env.accessSecret, { algorithms: ["HS256"] });
  } catch {
    throw new ApiError(401, "Invalid or expired authentication token");
  }

  const user = await User.findById(decoded.sub).select("+passwordChangedAt");

  if (!user) {
    throw new ApiError(401, "User not found");
  }

  if (user.passwordChangedAfter(decoded.iat)) {
    throw new ApiError(401, "Password was changed. Please sign in again");
  }

  if (user.status !== "active") {
    throw new ApiError(403, "This account is suspended");
  }

  req.user = user;
  next();
});

export const optionalProtect = asyncHandler(async (req, _res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;

  if (!token) {
    next();
    return;
  }

  try {
    const decoded = jwt.verify(token, env.accessSecret, { algorithms: ["HS256"] });
    const user = await User.findById(decoded.sub).select("+passwordChangedAt");

    if (user && user.status === "active" && !user.passwordChangedAfter(decoded.iat)) {
      req.user = user;
    }
  } catch {
    req.user = undefined;
  }

  next();
});
