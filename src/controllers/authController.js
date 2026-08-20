import mongoose from "mongoose";
import User from "../models/User.js";
import AdminProfile from "../models/AdminProfile.js";
import CreatorProfile from "../models/CreatorProfile.js";
import FanProfile from "../models/FanProfile.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { validateLoginPayload, validateRegisterPayload } from "../validators/authValidator.js";
import { issueAuthTokens } from "../services/tokenService.js";
import { sendWelcomeEmail } from "../services/emailService.js";
import { env } from "../config/env.js";
import jwt from "jsonwebtoken";

void mongoose;

const refreshCookieOptions = {
  httpOnly: true,
  // Production commonly uses separate Vercel and Render sites. Browsers only
  // send cross-site cookies when SameSite=None is paired with Secure.
  sameSite: env.nodeEnv === "production" ? "none" : "lax",
  secure: env.nodeEnv === "production",
  path: "/api/auth",
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

function sanitizeUser(user) {
  const effectiveRole = user.role === "admin" ? "admin" : user.creatorApprovalStatus === "approved" ? "creator" : "fan";
  return {
    id: user._id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: effectiveRole,
    accountRole: user.role === "admin" ? "admin" : "fan",
    creatorApprovalStatus: user.creatorApprovalStatus,
    avatar: user.avatar,
    isVerified: user.isVerified,
    status: user.status,
    activeStatus: user.activeStatus,
    lastSeenAt: user.lastSeenAt,
    onboarding: user.onboarding,
    onboardingChecklist: user.onboardingChecklist,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function createRoleProfile(user) {
  if (user.role === "creator") {
    await CreatorProfile.create({ user: user._id, verificationStatus: "pending" });
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

  const existingUser = await User.findOne({ $or: [{ email }, { username }] });
  if (existingUser) throw new ApiError(409, "A user with that email or username already exists");

  const userData = {
    name,
    username,
    email,
    password,
    role: "fan",
    creatorApprovalStatus: null,
  };

  const user = await User.create(userData);
  await createRoleProfile(user);

  // Email is a post-registration side effect: a provider outage must never
  // roll back an account that was created successfully.
  sendWelcomeEmail(user).catch((error) => console.error("Welcome email delivery failed", { userId: String(user._id), error: error.message }));

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

  if (user.status !== "active") {
    throw new ApiError(403, "This account is suspended");
  }
  if (user.loginRestrictedUntil && user.loginRestrictedUntil > new Date()) {
    throw new ApiError(403, `Account access is restricted until ${user.loginRestrictedUntil.toISOString()}`);
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

export const deleteAccount = asyncHandler(async (req, res) => {
  if (req.user.role === "admin") {
    throw new ApiError(403, "Administrator accounts cannot be deleted here");
  }

  req.user.status = "suspended";
  req.user.deletionRequestedAt = new Date();
  await req.user.save({ validateModifiedOnly: true });

  res.clearCookie("refreshToken", refreshCookieOptions);
  return sendResponse(res, 200, "Account deletion requested", {
    deletionRequestedAt: req.user.deletionRequestedAt,
  });
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
  if (!user || user.status !== "active" || (user.loginRestrictedUntil && user.loginRestrictedUntil > new Date())) {
    res.clearCookie("refreshToken", refreshCookieOptions);
    throw new ApiError(401, user?.loginRestrictedUntil > new Date() ? `Account access is restricted until ${user.loginRestrictedUntil.toISOString()}` : "User is not available");
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

