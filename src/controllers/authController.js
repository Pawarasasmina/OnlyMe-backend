import mongoose from "mongoose";
import User from "../models/User.js";
import { profileAccountType } from "../constants/profileCategoryConstants.js";
import AdminProfile from "../models/AdminProfile.js";
import CreatorProfile from "../models/CreatorProfile.js";
import FanProfile from "../models/FanProfile.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { validateLoginPayload, validateRegisterPayload } from "../validators/authValidator.js";
import { issueAuthTokens } from "../services/tokenService.js";
import { sendWelcomeEmail } from "../services/emailService.js";
import { recordAnalyticsEvent, readAnalyticsSessionId } from "../services/analyticsEventService.js";
import { env } from "../config/env.js";
import jwt from "jsonwebtoken";
import { attributeReferral, resolveReferral } from "../services/referralService.js";
import { nextMemberNumber } from "../services/memberTicketService.js";
import { accountOwnershipSummary, canRestoreAccount, changeAccountOwnership } from "../services/accountOwnershipService.js";
import AdminLoginEvent from "../models/AdminLoginEvent.js";
import { verifyTotp } from "../utils/totp.js";

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
    memberNumber: user.memberNumber,
    showMemberNumber: user.showMemberNumber !== false,
    profileAccountType: profileAccountType(user),
    profileCategory: user.profileCategory,
    email: user.email,
    role: effectiveRole,
    adminRole: effectiveRole === "admin" ? (user.adminRole || "MAIN_ADMIN") : null,
    adminTwoFactorEnabled: effectiveRole === "admin" ? Boolean(user.adminTwoFactorEnabled) : null,
    twoFactorEnabled: effectiveRole === "admin" ? Boolean(user.adminTwoFactorEnabled) : Boolean(user.twoFactorEnabled),
    profileType: user.profileType || (effectiveRole === "creator" ? "creator" : "personal"),
    accountRole: user.role === "admin" ? "admin" : "fan",
    creatorApprovalStatus: user.creatorApprovalStatus,
    avatar: user.avatar,
    isVerified: user.isVerified,
    status: user.status,
    activeStatus: user.activeStatus,
    lastSeenAt: user.lastSeenAt,
    onboarding: user.onboarding,
    onboardingChecklist: user.onboardingChecklist,
    dateOfBirth: user.dateOfBirth,
    preferredLanguage: user.preferredLanguage || "en",
    businessContact: user.businessContact || {},
    businessContactButtons: user.businessContactButtons || [],
    businessContactButtonsConfigured: Boolean(user.businessContactButtonsConfigured),
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

async function recordAuthAnalytics(req, user, eventType) {
  const sessionId = readAnalyticsSessionId(req);
  if (!sessionId) return;
  await recordAnalyticsEvent({ eventType: "SESSION_STARTED", req, sessionId, source: "unknown", userId: user._id });
  await recordAnalyticsEvent({ eventType, req, sessionId, source: "unknown", userId: user._id });
}

export const register = asyncHandler(async (req, res) => {
  const { name, username, email, password, dateOfBirth } = validateRegisterPayload(req.body);

  if (req.body.referralCode) await resolveReferral(req.body.referralCode);

  const existingUser = await User.findOne({ $or: [{ email }, { username }] });
  if (existingUser) throw new ApiError(409, "A user with that email or username already exists");

  const userData = {
    name,
    username,
    email,
    password,
    dateOfBirth,
    preferredLanguage: ["en", "ar", "ru", "uk", "es", "pt", "fr", "de"].includes(req.body.preferredLanguage) ? req.body.preferredLanguage : "en",
    profileType: "personal",
    role: "fan",
    creatorApprovalStatus: null,
  };

  let user;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      user = await User.create({ ...userData, memberNumber: await nextMemberNumber() });
      break;
    } catch (error) {
      const duplicateMemberNumber = error?.code === 11000 && (error?.keyPattern?.memberNumber || error?.keyValue?.memberNumber);
      if (duplicateMemberNumber && attempt < 2) continue;
      if (error?.code === 11000 && (error?.keyPattern?.email || error?.keyPattern?.username || error?.keyValue?.email || error?.keyValue?.username)) {
        throw new ApiError(409, "A user with that email or username already exists");
      }
      throw error;
    }
  }
  if (!user) throw new ApiError(503, "Could not reserve a member number. Please try again.");
  await createRoleProfile(user);
  await attributeReferral({ code: req.body.referralCode, invitee: user, shareIdentity: req.body.referralShareIdentity !== false });

  // Email is a post-registration side effect: a provider outage must never
  // roll back an account that was created successfully.
  sendWelcomeEmail(user).catch((error) => console.error("Welcome email delivery failed", { userId: String(user._id), error: error.message }));

  const tokens = issueAuthTokens(user);
  res.cookie("refreshToken", tokens.refreshToken, refreshCookieOptions);
  await recordAuthAnalytics(req, user, "LOGIN");
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

  if (user.role === "admin" && user.adminTwoFactorEnabled) {
    const profile = await AdminProfile.findOne({ user: user._id }).select("+twoFactorSecret");
    if (!profile?.twoFactorSecret || !verifyTotp(profile.twoFactorSecret, req.body.twoFactorCode)) throw new ApiError(401, "Enter the current six-digit authenticator code", "ADMIN_2FA_REQUIRED");
  }
  if (user.role !== "admin" && user.twoFactorEnabled) {
    const securedUser = await User.findById(user._id).select("+twoFactorSecret");
    if (!securedUser?.twoFactorSecret || !verifyTotp(securedUser.twoFactorSecret, req.body.twoFactorCode)) throw new ApiError(401, "Enter the current six-digit authenticator code", "TWO_FACTOR_REQUIRED");
  }

  if (canRestoreAccount(user)) {
    const restored = await User.findOneAndUpdate({ _id: user._id, status: user.status, ...(user.status === "pending_deletion" ? { deletionScheduledAt: { $gt: new Date() } } : {}) }, { $set: { status: "active", deactivatedAt: null, deletionRequestedAt: null, deletionScheduledAt: null } }, { new: true });
    if (restored) Object.assign(user, { status: restored.status, deactivatedAt: null, deletionRequestedAt: null, deletionScheduledAt: null });
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
    const ua = String(req.get("User-Agent") || "").toLowerCase();
    const deviceType = /ipad|tablet/.test(ua) ? "tablet" : /mobile|iphone|android/.test(ua) ? "mobile" : ua ? "desktop" : "unknown";
    await AdminLoginEvent.create({ user: user._id, outcome: "SUCCESS", ip: String(req.ip || "").slice(0, 100), userAgent: String(req.get("User-Agent") || "").slice(0, 500), deviceType });
  }
  if (user.role !== "admin") {
    const ua = String(req.get("User-Agent") || "").toLowerCase();
    const deviceType = /ipad|tablet/.test(ua) ? "tablet" : /mobile|iphone|android/.test(ua) ? "mobile" : ua ? "desktop" : "unknown";
    await AdminLoginEvent.create({ user: user._id, outcome: "SUCCESS", ip: String(req.ip || "").slice(0, 100), userAgent: String(req.get("User-Agent") || "").slice(0, 500), deviceType });
  }

  const tokens = issueAuthTokens(user);

  res.cookie("refreshToken", tokens.refreshToken, refreshCookieOptions);
  await recordAuthAnalytics(req, user, "LOGIN");

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
  const user = await changeAccountOwnership(req.user, "delete", req.body?.acknowledgeEarningsLoss === true);
  req.app.get("io")?.in(`user:${req.user._id}`).disconnectSockets(true);
  res.clearCookie("refreshToken", refreshCookieOptions);
  return sendResponse(res, 200, "Account deletion requested", {
    deletionRequestedAt: user.deletionRequestedAt,
    deletionScheduledAt: user.deletionScheduledAt,
  });
});

export const getAccountOwnership = asyncHandler(async (req, res) => sendResponse(res, 200, "Account ownership fetched", await accountOwnershipSummary(req.user)));
export const deactivateAccount = asyncHandler(async (req, res) => {
  await changeAccountOwnership(req.user, "deactivate");
  req.app.get("io")?.in(`user:${req.user._id}`).disconnectSockets(true);
  res.clearCookie("refreshToken", refreshCookieOptions);
  return sendResponse(res, 200, "Account deactivated");
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
  if (!user || user.status !== "active" || (decoded.authVersion || 0) !== (user.authVersion || 0) || (user.loginRestrictedUntil && user.loginRestrictedUntil > new Date())) {
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

export const updateProfileType = asyncHandler(async (req, res) => {
  if (req.user.role === "admin") throw new ApiError(403, "Administrator account type cannot be changed here");
  const profileType = String(req.body.profileType || "").trim().toLowerCase();
  if (!["personal", "creator", "business"].includes(profileType)) throw new ApiError(400, "Choose Personal, Creator, or Business");
  if (req.body.confirmed !== true) throw new ApiError(400, "Confirm the account type change");
  const category = String(req.body.category || "").trim().slice(0, 40);
  const contactButtons = [...new Set((Array.isArray(req.body.contactButtons) ? req.body.contactButtons : []).map((item) => String(item || "").trim().toLowerCase()))]
    .filter((item) => ["call", "directions", "website"].includes(item));
  req.user.profileType = profileType;
  if (profileType === "personal") req.user.businessContact = { call: "", directions: "", website: "" };
  if (profileType !== "business") req.user.businessContactButtons = [];
  if (profileType !== "business") req.user.businessContactButtonsConfigured = false;
  if (profileType === "business") {
    req.user.businessContactButtons = contactButtons;
    req.user.businessContactButtonsConfigured = true;
  }
  await req.user.save({ validateModifiedOnly: true });
  if (["creator", "business"].includes(profileType)) {
    const profileUpdate = category ? { $set: { category, categories: [category] } } : {};
    await CreatorProfile.findOneAndUpdate(
      { user: req.user._id },
      { ...profileUpdate, $setOnInsert: { user: req.user._id, verificationStatus: "pending" } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  return sendResponse(res, 200, "Account type updated", { user: sanitizeUser(req.user) });
});

