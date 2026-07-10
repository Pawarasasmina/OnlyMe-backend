import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { validateLoginPayload, validateRegisterPayload } from "../validators/authValidator.js";
import { issueAuthTokens } from "../services/tokenService.js";
import { env } from "../config/env.js";

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

export const register = asyncHandler(async (req, res) => {
  validateRegisterPayload(req.body);

  const { name, username, email, password, role } = req.body;

  const existingUser = await User.findOne({
    $or: [{ email: email.toLowerCase() }, { username: username.toLowerCase() }],
  });

  if (existingUser) {
    throw new ApiError(409, "A user with that email or username already exists");
  }

  const user = await User.create({
    name,
    username,
    email,
    password,
    role,
  });

  const tokens = issueAuthTokens(user);

  res.cookie("refreshToken", tokens.refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.nodeEnv === "production",
  });

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

  const tokens = issueAuthTokens(user);

  res.cookie("refreshToken", tokens.refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.nodeEnv === "production",
  });

  return sendResponse(res, 200, "Login successful", {
    user: sanitizeUser(user),
    accessToken: tokens.accessToken,
  });
});

export const logout = asyncHandler(async (_req, res) => {
  res.clearCookie("refreshToken");
  return sendResponse(res, 200, "Logout successful");
});

export const getMe = asyncHandler(async (req, res) => {
  return sendResponse(res, 200, "Authenticated user fetched", {
    user: sanitizeUser(req.user),
  });
});
