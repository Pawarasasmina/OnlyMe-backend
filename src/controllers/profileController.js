import mongoose from "mongoose";
import AdminProfile from "../models/AdminProfile.js";
import CreatorProfile from "../models/CreatorProfile.js";
import FanProfile from "../models/FanProfile.js";
import User from "../models/User.js";
import UserBlock from "../models/UserBlock.js";
import Content from "../models/Content.js";
import { serializeContent } from "../services/contentAccessService.js";
import { deleteStoredFile, storeFile } from "../services/storageService.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import {
  normalizeUsername,
  validateRoleProfilePayload,
  validateSettingsPayload,
  validateUsername,
} from "../validators/profileValidator.js";

const profileModels = {
  admin: AdminProfile,
  creator: CreatorProfile,
  fan: FanProfile,
};

function stripUndefined(value) {
  return Object.entries(value).reduce((result, [key, entry]) => {
    if (entry !== undefined) {
      result[key] = entry;
    }

    return result;
  }, {});
}

function accountDetails(user) {
  return {
    id: user._id,
    displayName: user.name,
    username: user.username,
    email: user.email,
    role: user.role,
    profilePhoto: user.avatar,
    isVerified: user.isVerified,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function ensureRoleProfile(user) {
  const Model = profileModels[user.role];

  if (!Model) {
    throw new ApiError(400, "Unsupported user role");
  }

  return Model.findOneAndUpdate(
    { user: user._id },
    { $setOnInsert: { user: user._id } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

function serializeOwnProfile(user, profile) {
  const serialized = {
    account: accountDetails(user),
    profile: {
      id: profile._id,
      role: user.role,
      displayName: user.name,
      username: user.username,
      profilePhoto: user.avatar,
      preferredLanguage: profile.preferredLanguage,
      timezone: profile.timezone,
      notificationPreferences: profile.notificationPreferences,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    },
  };

  if (user.role === "creator") {
    serialized.profile = {
      ...serialized.profile,
      coverPhoto: profile.coverPhoto,
      bio: profile.bio,
      categories: profile.categories?.length ? profile.categories : profile.category ? [profile.category] : [],
      city: profile.city,
      country: profile.country,
      socialLinks: profile.socialLinks || [],
      subscriptionPriceCents: profile.subscriptionPriceCents,
      nsfwEnabled: profile.nsfwEnabled,
      freePreviewEnabled: profile.freePreviewEnabled,
      messagingEnabled: profile.messagingEnabled,
      ppmEnabled: profile.ppmEnabled,
      ppmPrice: profile.ppmPrice,
      profileVisibility: profile.profileVisibility,
      verificationStatus: user.isVerified ? "verified" : profile.verificationStatus,
    };
  }

  if (user.role === "fan") {
    serialized.profile = {
      ...serialized.profile,
      bio: profile.bio,
      profileVisibility: profile.profileVisibility,
    };
  }

  if (user.role === "admin") {
    serialized.profile = {
      ...serialized.profile,
      phoneNumber: profile.phoneNumber,
      lastLoginAt: profile.lastLoginAt,
    };
  }

  serialized.completion = calculateCompletion(user, profile);
  return serialized;
}

function serializeBlockedAccount(block) {
  const blocked = block.blocked;

  return {
    id: blocked._id,
    blockId: block._id,
    displayName: blocked.name,
    username: blocked.username,
    role: blocked.role,
    profilePhoto: blocked.avatar,
    isVerified: blocked.isVerified,
    blockedAt: block.createdAt,
  };
}

function calculateCompletion(user, profile) {
  if (user.role === "creator") {
    const categories = profile.categories?.length ? profile.categories : profile.category ? [profile.category] : [];
    const checks = [
      Boolean(user.name),
      Boolean(user.username),
      Boolean(user.avatar),
      Boolean(profile.bio),
      categories.length > 0,
      Number(profile.subscriptionPriceCents) >= 300,
      user.isVerified || profile.verificationStatus !== "not_submitted",
    ];

    return {
      percentage: Math.round((checks.filter(Boolean).length / checks.length) * 100),
      completed: checks.filter(Boolean).length,
      total: checks.length,
    };
  }

  if (user.role === "fan") {
    const checks = [Boolean(user.name), Boolean(user.username), Boolean(user.avatar)];

    return {
      percentage: Math.round((checks.filter(Boolean).length / checks.length) * 100),
      completed: checks.filter(Boolean).length,
      total: checks.length,
    };
  }

  return { percentage: 100, completed: 1, total: 1 };
}

export const getMyProfile = asyncHandler(async (req, res) => {
  const profile = await ensureRoleProfile(req.user);

  return sendResponse(res, 200, "Profile fetched", serializeOwnProfile(req.user, profile));
});

export const getMyPrivacySettings = asyncHandler(async (req, res) => {
  const profile = await ensureRoleProfile(req.user);
  return sendResponse(res, 200, "Privacy settings fetched", {
    role: req.user.role,
    profileVisibility: profile.profileVisibility || (req.user.role === "creator" ? "public" : "private"),
    privacySettings: profile.privacySettings || {},
  });
});

export const updateMyPrivacySettings = asyncHandler(async (req, res) => {
  const updates = stripUndefined(validateSettingsPayload(req.user.role, "privacy", req.body));
  const Model = profileModels[req.user.role];
  await Model.updateOne(
    { user: req.user._id },
    { $set: updates, $setOnInsert: { user: req.user._id } },
    { upsert: true, runValidators: true }
  );
  const profile = await ensureRoleProfile(req.user);
  return sendResponse(res, 200, "Privacy settings updated", {
    role: req.user.role,
    profileVisibility: profile.profileVisibility || (req.user.role === "creator" ? "public" : "private"),
    privacySettings: profile.privacySettings || {},
  });
});

export const listMyBlockedAccounts = asyncHandler(async (req, res) => {
  const blocks = await UserBlock.find({ blocker: req.user._id })
    .sort({ createdAt: -1 })
    .populate("blocked", "name username role avatar isVerified status")
    .lean();

  return sendResponse(res, 200, "Blocked accounts fetched", {
    items: blocks.filter((block) => block.blocked).map(serializeBlockedAccount),
  });
});

export const unblockAccount = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.userId)) {
    throw new ApiError(400, "Invalid account");
  }

  const result = await UserBlock.deleteOne({ blocker: req.user._id, blocked: req.params.userId });

  return sendResponse(res, 200, result.deletedCount ? "Account unblocked" : "Account was not blocked", {
    blockedUserId: req.params.userId,
    unblocked: true,
  });
});

export const getMyNotificationSettings = asyncHandler(async (req, res) => {
  const profile = await ensureRoleProfile(req.user);
  return sendResponse(res, 200, "Notification settings fetched", {
    role: req.user.role,
    notificationPreferences: profile.notificationPreferences || {},
  });
});

export const updateMyNotificationSettings = asyncHandler(async (req, res) => {
  const updates = stripUndefined(validateSettingsPayload(req.user.role, "notifications", req.body));
  const Model = profileModels[req.user.role];
  await Model.updateOne(
    { user: req.user._id },
    { $set: updates, $setOnInsert: { user: req.user._id } },
    { upsert: true, runValidators: true }
  );
  const profile = await ensureRoleProfile(req.user);
  return sendResponse(res, 200, "Notification settings updated", {
    role: req.user.role,
    notificationPreferences: profile.notificationPreferences || {},
  });
});

export const getMyAccountSettings = asyncHandler(async (req, res) => {
  const profile = await ensureRoleProfile(req.user);
  return sendResponse(res, 200, "Account settings fetched", {
    account: accountDetails(req.user),
    preferences: {
      preferredLanguage: profile.preferredLanguage,
      timezone: profile.timezone,
      phoneNumber: profile.phoneNumber || "",
    },
  });
});

export const updateMyAccountSettings = asyncHandler(async (req, res) => {
  const updates = stripUndefined(validateSettingsPayload(req.user.role, "account", req.body));
  const Model = profileModels[req.user.role];
  await Model.updateOne(
    { user: req.user._id },
    { $set: updates, $setOnInsert: { user: req.user._id } },
    { upsert: true, runValidators: true }
  );
  const profile = await ensureRoleProfile(req.user);
  return sendResponse(res, 200, "Account settings updated", {
    account: accountDetails(req.user),
    preferences: {
      preferredLanguage: profile.preferredLanguage,
      timezone: profile.timezone,
      phoneNumber: profile.phoneNumber || "",
    },
  });
});

export const updateMyProfile = asyncHandler(async (req, res) => {
  const { common, profile } = validateRoleProfilePayload(req.user.role, req.body, req.user);
  const commonUpdates = stripUndefined(common);
  const profileUpdates = stripUndefined(profile);

  if (Object.keys(commonUpdates).length) {
    await User.updateOne({ _id: req.user._id }, { $set: commonUpdates });
  }

  if (Object.keys(profileUpdates).length) {
    const Model = profileModels[req.user.role];

    await Model.updateOne(
      { user: req.user._id },
      { $set: profileUpdates, $setOnInsert: { user: req.user._id } },
      { upsert: true, runValidators: true }
    );
  }

  const user = await User.findById(req.user._id);
  const updatedProfile = await ensureRoleProfile(user);

  return sendResponse(res, 200, "Profile updated", serializeOwnProfile(user, updatedProfile));
});

export const changeMyPassword = asyncHandler(async (req, res) => {
  const currentPassword = String(req.body.currentPassword || "");
  const newPassword = String(req.body.newPassword || "");

  if (!currentPassword || !newPassword) {
    throw new ApiError(400, "Current password and new password are required");
  }
  if (newPassword.length < 8 || newPassword.length > 128) {
    throw new ApiError(400, "New password must be between 8 and 128 characters");
  }
  if (currentPassword === newPassword) {
    throw new ApiError(400, "New password must be different from the current password");
  }

  const user = await User.findById(req.user._id).select("+password");
  if (!user || !(await user.comparePassword(currentPassword))) {
    throw new ApiError(400, "Current password is incorrect");
  }

  user.password = newPassword;
  await user.save();
  return sendResponse(res, 200, "Password changed successfully");
});

export const uploadMyAvatar = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new ApiError(400, "Profile photo is required");
  }

  const storedFile = await storeFile(req.file);
  const oldAvatar = req.user.avatar;

  req.user.avatar = storedFile.url;
  await req.user.save();

  if (oldAvatar && oldAvatar !== storedFile.url) {
    await deleteStoredFile(oldAvatar);
  }

  const profile = await ensureRoleProfile(req.user);

  return sendResponse(res, 200, "Profile photo updated", serializeOwnProfile(req.user, profile));
});

export const removeMyAvatar = asyncHandler(async (req, res) => {
  const oldAvatar = req.user.avatar;

  req.user.avatar = "";
  await req.user.save();

  if (oldAvatar) {
    await deleteStoredFile(oldAvatar);
  }

  const profile = await ensureRoleProfile(req.user);

  return sendResponse(res, 200, "Profile photo removed", serializeOwnProfile(req.user, profile));
});

export const uploadMyCover = asyncHandler(async (req, res) => {
  if (req.user.role !== "creator") {
    throw new ApiError(403, "Only creators can upload a cover photo");
  }

  if (!req.file) {
    throw new ApiError(400, "Cover photo is required");
  }

  const profile = await ensureRoleProfile(req.user);
  const oldCover = profile.coverPhoto;
  const storedFile = await storeFile(req.file);

  profile.coverPhoto = storedFile.url;
  await profile.save();

  if (oldCover && oldCover !== storedFile.url) {
    await deleteStoredFile(oldCover);
  }

  return sendResponse(res, 200, "Cover photo updated", serializeOwnProfile(req.user, profile));
});

export const removeMyCover = asyncHandler(async (req, res) => {
  if (req.user.role !== "creator") {
    throw new ApiError(403, "Only creators can remove a cover photo");
  }

  const profile = await ensureRoleProfile(req.user);
  const oldCover = profile.coverPhoto;

  profile.coverPhoto = "";
  await profile.save();

  if (oldCover) {
    await deleteStoredFile(oldCover);
  }

  return sendResponse(res, 200, "Cover photo removed", serializeOwnProfile(req.user, profile));
});

export const checkUsernameAvailability = asyncHandler(async (req, res) => {
  const username = validateUsername(req.query.username);
  const currentUserId = req.user?._id ?? new mongoose.Types.ObjectId();
  const existingUser = await User.findOne({ username, _id: { $ne: currentUserId } }).select("_id");

  return sendResponse(res, 200, "Username availability checked", {
    username,
    available: !existingUser,
  });
});

export const getMyProfileCompletion = asyncHandler(async (req, res) => {
  const profile = await ensureRoleProfile(req.user);

  return sendResponse(res, 200, "Profile completion fetched", calculateCompletion(req.user, profile));
});

export const getPublicCreatorProfile = asyncHandler(async (req, res) => {
  const username = normalizeUsername(req.params.username);
  const user = await User.findOne({
    username,
    role: "creator",
    status: "active",
    creatorApprovalStatus: "approved",
  });

  if (!user) {
    throw new ApiError(404, "Creator profile not found");
  }

  const profile = await ensureRoleProfile(user);

  if (profile.profileVisibility !== "public") {
    throw new ApiError(404, "Creator profile not found");
  }

  const posts = await Content.find({ creator: user._id, status: { $in: ["PUBLISHED", "published"] } })
    .sort({ publishedAt: -1 }).limit(20).populate("creator", "name username avatar").lean();
  return sendResponse(res, 200, "Creator profile fetched", {
    creator: {
      displayName: user.name,
      username: user.username,
      profilePhoto: user.avatar,
      coverPhoto: profile.coverPhoto,
      isVerified: user.isVerified,
      bio: profile.bio,
      categories: profile.categories?.length ? profile.categories : profile.category ? [profile.category] : [],
      city: profile.city,
      country: profile.country,
      socialLinks: profile.socialLinks || [],
      subscriptionPriceCents: profile.subscriptionPriceCents,
      freePreviewEnabled: profile.freePreviewEnabled,
      messagingEnabled: profile.messagingEnabled,
      joinedAt: user.createdAt,
    },
    posts: posts.map((post) => serializeContent(post, null)),
  });
});

export const getPublicFanProfile = asyncHandler(async (req, res) => {
  const username = normalizeUsername(req.params.username);
  const user = await User.findOne({ username, role: "fan", status: "active" });

  if (!user) {
    throw new ApiError(404, "Fan profile not found");
  }

  const profile = await ensureRoleProfile(user);

  if (profile.profileVisibility !== "public") {
    throw new ApiError(404, "Fan profile not found");
  }

  return sendResponse(res, 200, "Fan profile fetched", {
    fan: {
      displayName: user.name,
      username: user.username,
      profilePhoto: user.avatar,
      bio: profile.bio,
      joinedAt: user.createdAt,
    },
  });
});
