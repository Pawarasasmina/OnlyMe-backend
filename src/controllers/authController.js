import User from "../models/User.js";
import AdminProfile from "../models/AdminProfile.js";
import CreatorProfile from "../models/CreatorProfile.js";
import FanProfile from "../models/FanProfile.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { validateLoginPayload, validateRegisterPayload } from "../validators/authValidator.js";
import { issueAuthTokens } from "../services/tokenService.js";
import { env } from "../config/env.js";
import jwt from "jsonwebtoken";

const refreshCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: env.nodeEnv === "production",
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

function sanitizeUser(user) {
  return {
    id: user._id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
    isVerified: user.isVerified,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function createRoleProfile(user) {
  if (user.role === "creator") {
    await CreatorProfile.create({ user: user._id });
  }

  if (user.role === "fan") {
    await FanProfile.create({ user: user._id });
  }

  if (user.role === "admin") {
    await AdminProfile.create({ user: user._id });
  }
}

export const register = asyncHandler(async (req, res) => {
  const { name, username, email, password } = validateRegisterPayload(req.body);
  const { role } = req.body;

  if (role && !["fan", "creator"].includes(role)) {
    throw new ApiError(400, "You can only register as a fan or creator");
  }

  const existingUser = await User.findOne({
    $or: [{ email }, { username }],
  });

  if (existingUser) {
    throw new ApiError(409, "A user with that email or username already exists");
  }

  const user = await User.create({
    name,
    username,
    email,
    password,
    role: role || "fan",
  });
  await createRoleProfile(user);

  const tokens = issueAuthTokens(user);

  res.cookie("refreshToken", tokens.refreshToken, refreshCookieOptions);

  return sendResponse(res, 201, "Registration successful", {
    user: sanitizeUser(user),
    accessToken: tokens.accessToken,
  });
});

export const login = asyncHandler(async (req, res) => {
  validateLoginPayload(req.body);

  const { email, password } = req.body;

  const user = await User.findOne({ email: email.toLowerCase() }).select("+password");

  if (!user || !(await user.comparePassword(password))) {
    throw new ApiError(401, "Invalid email or password");
  }

  if (user.role === "admin") {
    await AdminProfile.findOneAndUpdate(
      { user: user._id },
      { $set: { lastLoginAt: new Date() }, $setOnInsert: { user: user._id } },
      { upsert: true }
    );
  }

  const tokens = issueAuthTokens(user);

  res.cookie("refreshToken", tokens.refreshToken, refreshCookieOptions);

  return sendResponse(res, 200, "Login successful", {
    user: sanitizeUser(user),
    accessToken: tokens.accessToken,
  });
});

export const logout = asyncHandler(async (_req, res) => {
  res.clearCookie("refreshToken", refreshCookieOptions);
  return sendResponse(res, 200, "Logout successful");
});

export const refreshSession = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  if (!refreshToken) {
    throw new ApiError(401, "Refresh token is required");
  }

  let decoded;
  try {
    decoded = jwt.verify(refreshToken, env.refreshSecret);
  } catch {
    res.clearCookie("refreshToken", refreshCookieOptions);
    throw new ApiError(401, "Refresh token is invalid or expired");
  }

  const user = await User.findById(decoded.sub);
  if (!user || user.status !== "active") {
    res.clearCookie("refreshToken", refreshCookieOptions);
    throw new ApiError(401, "User is not available");
  }

  const tokens = issueAuthTokens(user);
  res.cookie("refreshToken", tokens.refreshToken, refreshCookieOptions);
  return sendResponse(res, 200, "Session refreshed", {
    accessToken: tokens.accessToken,
  });
});

export const getMe = asyncHandler(async (req, res) => {
  return sendResponse(res, 200, "Authenticated user fetched", {
    user: sanitizeUser(req.user),
  });
});
