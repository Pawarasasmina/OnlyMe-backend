import mongoose from "mongoose";
import User from "../models/User.js";
import AdminProfile from "../models/AdminProfile.js";
import CreatorProfile from "../models/CreatorProfile.js";
import FanProfile from "../models/FanProfile.js";
import CreatorVerification from "../models/CreatorVerification.js";
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
    creatorApprovalStatus: user.creatorApprovalStatus,
    avatar: user.avatar,
    isVerified: user.isVerified,
    status: user.status,
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
  const { name, username, email, password } = validateRegisterPayload(req.body);
  const { role } = req.body;

  if (role && !["fan", "creator"].includes(role)) {
    throw new ApiError(400, "You can only register as a fan or creator");
  }

  const existingUser = await User.findOne({ $or: [{ email }, { username }] });
  if (existingUser) throw new ApiError(409, "A user with that email or username already exists");

  const userData = {
    name,
    username,
    email,
    password,
    role: role || "fan",
    creatorApprovalStatus: role === "creator" ? "pending" : null,
  };

  const user = role === "creator" ? await createCreatorAccount(userData) : await User.create(userData);
  if (user.role !== "creator") await createRoleProfile(user);

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

