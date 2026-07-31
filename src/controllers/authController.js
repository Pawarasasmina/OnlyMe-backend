import mongoose from "mongoose";
import crypto from "node:crypto";
import User from "../models/User.js";
import AdminProfile from "../models/AdminProfile.js";
import CreatorProfile from "../models/CreatorProfile.js";
import FanProfile from "../models/FanProfile.js";
import CreatorVerification from "../models/CreatorVerification.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import {
  validateForgotPasswordPayload,
  validateLoginPayload,
  validateRegisterPayload,
  validateResetPasswordPayload,
} from "../validators/authValidator.js";
import {
  issueAccessToken,
  issueAuthTokens,
  revokeAllUserRefreshSessions,
  revokeRefreshToken,
  rotateRefreshSession,
  validateRefreshSession,
} from "../services/tokenService.js";
import { sendResetPasswordEmail } from "../services/emailService.js";
import { env } from "../config/env.js";
import jwt from "jsonwebtoken";
import { initialOnboardingState } from "../services/onboardingService.js";

const resetPasswordSuccessMessage = "If an account with that email exists, password reset instructions have been sent.";
const resetPasswordTokenExpiresInMs = 60 * 60 * 1000;

function durationToMs(value, fallbackMs) {
  if (typeof value === "number") return value * 1000;
  const match = String(value || "").trim().match(/^(\d+)(ms|s|m|h|d)?$/);
  if (!match) return fallbackMs;

  const amount = Number(match[1]);
  const unit = match[2] || "s";
  const multipliers = { ms: 1, s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  return amount * multipliers[unit];
}

const refreshCookieOptions = {
  httpOnly: true,
  sameSite: env.cookieSameSite,
  secure: env.cookieSecure,
  domain: env.cookieDomain,
  path: "/",
  maxAge: durationToMs(env.refreshExpiresIn, 30 * 24 * 60 * 60 * 1000),
};

function resolveCurrentOnboardingStep(onboarding, role) {
  if (!onboarding?.status) return role === "admin" ? "completed" : "completed";
  if (onboarding.status === "completed" || onboarding.status === "skipped") return "completed";
  if (!onboarding.welcomeCompleted) return "welcome";
  if (!onboarding.interestsCompleted) return "interests";
  if (!onboarding.instinctsCompleted) return "instincts";
  if (!onboarding.peopleCompleted) return "people";
  if (!onboarding.checklistAcknowledged) return "light-your-world";
  return "complete";
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function buildResetUrl(token) {
  const resetUrl = new URL("/reset-password", env.clientUrl);
  resetUrl.searchParams.set("token", token);
  return resetUrl.toString();
}

function sanitizeUser(user) {
  const onboarding = user.onboarding?.status
    ? {
      status: user.onboarding.status,
      version: user.onboarding.version || 1,
      currentStep: resolveCurrentOnboardingStep(user.onboarding, user.role),
      startedAt: user.onboarding.startedAt || null,
      welcomeCompleted: Boolean(user.onboarding.welcomeCompleted),
      interestsCompleted: Boolean(user.onboarding.interestsCompleted),
      instinctsCompleted: Boolean(user.onboarding.instinctsCompleted),
      peopleCompleted: Boolean(user.onboarding.peopleCompleted),
      checklistAcknowledged: Boolean(user.onboarding.checklistAcknowledged),
      skippedSteps: user.onboarding.skippedSteps || [],
      completedAt: user.onboarding.completedAt || null,
      skippedAt: user.onboarding.skippedAt || null,
    }
    : {
      ...initialOnboardingState(),
      status: user.role === "admin" ? "completed" : "completed",
      currentStep: "completed",
      completedAt: user.createdAt || null,
    };

  return {
    id: user._id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role,
    creatorApprovalStatus: user.creatorApprovalStatus,
    avatar: user.avatar,
    isVerified: user.isVerified,
    status: user.status,
    onboarding,
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

const transactionsUnsupported = (error) => /Transaction numbers are only allowed|does not support transactions|replica set/i.test(error.message || "");

async function createCreatorAccount(data) {
  const session = await mongoose.startSession();
  try {
    let createdUser;
    await session.withTransaction(async () => {
      [createdUser] = await User.create([data], { session });
      await CreatorProfile.create([{ user: createdUser._id, verificationStatus: "not_submitted" }], { session });
      await CreatorVerification.create([{ creator: createdUser._id, status: "NOT_STARTED" }], { session });
    });
    return createdUser;
  } catch (error) {
    if (!transactionsUnsupported(error)) throw error;
  } finally {
    await session.endSession();
  }

  let createdUser;
  try {
    createdUser = await User.create(data);
    await CreatorProfile.create({ user: createdUser._id, verificationStatus: "not_submitted" });
    await CreatorVerification.create({ creator: createdUser._id, status: "NOT_STARTED" });
    return createdUser;
  } catch (error) {
    if (createdUser) {
      await Promise.all([
        CreatorVerification.deleteOne({ creator: createdUser._id }),
        CreatorProfile.deleteOne({ user: createdUser._id }),
        User.deleteOne({ _id: createdUser._id }),
      ]);
    }
    throw error;
  }
}

export const register = asyncHandler(async (req, res) => {
  const { name, username, email, password, role } = validateRegisterPayload(req.body);

  const existingUser = await User.findOne({ $or: [{ email }, { username }] });
  if (existingUser?.email === email) {
    throw new ApiError(409, "An account already exists with this email address.", {
      email: "An account already exists with this email address.",
    });
  }
  if (existingUser?.username === username) {
    throw new ApiError(409, "This username is already taken.", {
      username: "This username is already taken.",
    });
  }

  const userData = {
    name,
    username,
    email,
    password,
    role: role || "fan",
    creatorApprovalStatus: role === "creator" ? "pending" : null,
    onboarding: initialOnboardingState(),
  };

  try {
    const user = role === "creator" ? await createCreatorAccount(userData) : await User.create(userData);
    if (user.role !== "creator") await createRoleProfile(user);

    const tokens = await issueAuthTokens(user);
    res.cookie("refreshToken", tokens.refreshToken, refreshCookieOptions);
    return sendResponse(res, 201, "Account created successfully.", {
      user: sanitizeUser(user),
      accessToken: tokens.accessToken,
    });
  } catch (error) {
    if (error.code === 11000) {
      if (error.keyPattern?.email) {
        throw new ApiError(409, "An account already exists with this email address.", {
          email: "An account already exists with this email address.",
        });
      }
      if (error.keyPattern?.username) {
        throw new ApiError(409, "This username is already taken.", {
          username: "This username is already taken.",
        });
      }
    }
    throw error;
  }
});
export const login = asyncHandler(async (req, res) => {
  const { email, password } = validateLoginPayload(req.body);

  const user = await User.findOne({ email }).select("+password");

  if (!user || !(await user.comparePassword(password))) {
    throw new ApiError(401, "The email address or password is incorrect.");
  }

  if (user.status !== "active") {
    throw new ApiError(403, "This account is suspended");
  }

  if (user.role === "admin") {
    await AdminProfile.findOneAndUpdate(
      { user: user._id },
      { $set: { lastLoginAt: new Date() }, $setOnInsert: { user: user._id } },
      { upsert: true }
    );
  }

  const tokens = await issueAuthTokens(user);

  res.cookie("refreshToken", tokens.refreshToken, refreshCookieOptions);

  return sendResponse(res, 200, "Signed in successfully.", {
    user: sanitizeUser(user),
    accessToken: tokens.accessToken,
  });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = validateForgotPasswordPayload(req.body);
  const user = await User.findOne({ email }).select("+resetPasswordToken +resetPasswordExpires");

  if (!user) {
    return sendResponse(res, 200, resetPasswordSuccessMessage);
  }

  const resetToken = crypto.randomBytes(32).toString("hex");
  user.resetPasswordToken = hashResetToken(resetToken);
  user.resetPasswordExpires = new Date(Date.now() + resetPasswordTokenExpiresInMs);
  await user.save({ validateBeforeSave: false });

  try {
    await sendResetPasswordEmail({
      to: user.email,
      name: user.name,
      resetUrl: buildResetUrl(resetToken),
    });
  } catch (error) {
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save({ validateBeforeSave: false });
    console.error("Failed to send reset password email", error);
  }

  return sendResponse(res, 200, resetPasswordSuccessMessage);
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, newPassword } = validateResetPasswordPayload(req.body);
  const tokenHash = hashResetToken(token);
  const user = await User.findOne({ resetPasswordToken: tokenHash }).select(
    "+password +resetPasswordToken +resetPasswordExpires"
  );

  if (!user) {
    throw new ApiError(400, "Reset token is invalid or has already been used");
  }

  if (!user.resetPasswordExpires || user.resetPasswordExpires <= new Date()) {
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save({ validateBeforeSave: false });
    throw new ApiError(400, "Reset token has expired");
  }

  user.password = newPassword;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();
  await revokeAllUserRefreshSessions(user._id);

  res.clearCookie("refreshToken", refreshCookieOptions);
  return sendResponse(res, 200, "Password reset successful");
});

export const logout = asyncHandler(async (req, res) => {
  await revokeRefreshToken(req.cookies.refreshToken);
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
    decoded = jwt.verify(refreshToken, env.refreshSecret, { algorithms: ["HS256"] });
  } catch {
    res.clearCookie("refreshToken", refreshCookieOptions);
    throw new ApiError(401, "Refresh token is invalid or expired");
  }

  const refreshSession = await validateRefreshSession(refreshToken, decoded);
  if (!refreshSession) {
    res.clearCookie("refreshToken", refreshCookieOptions);
    throw new ApiError(401, "Refresh token is invalid or expired");
  }

  const user = await User.findById(decoded.sub).select("+passwordChangedAt");
  if (!user || user.status !== "active") {
    await revokeRefreshToken(refreshToken);
    res.clearCookie("refreshToken", refreshCookieOptions);
    throw new ApiError(401, "User is not available");
  }

  if (user.passwordChangedAfter(decoded.iat)) {
    await revokeAllUserRefreshSessions(user._id);
    res.clearCookie("refreshToken", refreshCookieOptions);
    throw new ApiError(401, "Password was changed. Please sign in again");
  }

  const nextRefreshToken = await rotateRefreshSession(refreshSession, user);
  if (!nextRefreshToken) {
    res.clearCookie("refreshToken", refreshCookieOptions);
    throw new ApiError(401, "Refresh token is invalid or expired");
  }

  res.cookie("refreshToken", nextRefreshToken, refreshCookieOptions);
  return sendResponse(res, 200, "Session refreshed", {
    accessToken: issueAccessToken(user),
  });
});

export const getMe = asyncHandler(async (req, res) => {
  return sendResponse(res, 200, "Authenticated user fetched", {
    user: sanitizeUser(req.user),
  });
});

