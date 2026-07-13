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

  req.user = user;
  next();
});
