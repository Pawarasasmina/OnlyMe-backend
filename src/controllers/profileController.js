import mongoose from "mongoose";
import AdminProfile from "../models/AdminProfile.js";
import CreatorProfile from "../models/CreatorProfile.js";
import FanProfile from "../models/FanProfile.js";
import User from "../models/User.js";
import Content from "../models/Content.js";
import OrbitDream from "../models/OrbitDream.js";
import Subscription from "../models/Subscription.js";
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
  validateUsernameCandidate,
} from "../validators/profileValidator.js";
import { validatePasswordPolicy } from "../validators/authValidator.js";
import { revokeAllUserRefreshSessions } from "../services/tokenService.js";

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
    avatar: user.avatar,
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
      avatar: user.avatar,
      coverPhoto: profile.coverPhoto || "",
      cover: profile.coverPhoto || "",
      preferredLanguage: profile.preferredLanguage,
      timezone: profile.timezone,
      notificationPreferences: profile.notificationPreferences,
      privacySettings: profile.privacySettings || {},
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    },
  };

  if (user.role === "creator") {
    serialized.profile = {
      ...serialized.profile,
      coverPhoto: profile.coverPhoto,
      cover: profile.coverPhoto,
      bio: profile.bio,
      categories: profile.categories?.length ? profile.categories : profile.category ? [profile.category] : [],
      city: profile.city,
      country: profile.country,
      orbitStatus: profile.orbitStatus,
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
      coverPhoto: profile.coverPhoto,
      cover: profile.coverPhoto,
      interests: profile.interests || [],
      orbitStatus: profile.orbitStatus,
      city: profile.city,
      country: profile.country,
      profileVisibility: profile.profileVisibility,
    };
  }

  if (user.role === "admin") {
    serialized.profile = {
      ...serialized.profile,
      phoneNumber: profile.phoneNumber,
      bio: profile.bio,
      profileVisibility: profile.profileVisibility,
      privacySettings: profile.privacySettings || {},
      lastLoginAt: profile.lastLoginAt,
    };
  }

  serialized.completion = calculateCompletion(user, profile);
  return serialized;
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

export const updateMyProfile = asyncHandler(async (req, res) => {
  const { common, profile } = validateRoleProfilePayload(req.user.role, req.body, req.user);
  const commonUpdates = stripUndefined(common);
  const profileUpdates = stripUndefined(profile);

  if (Object.keys(commonUpdates).length) {
    if (commonUpdates.username) {
      const usernameOwner = await User.findOne({
        username: commonUpdates.username,
        _id: { $ne: req.user._id },
      }).select("_id");

      if (usernameOwner) {
        throw new ApiError(409, "This username is already taken.", {
          username: "This username is already taken.",
        });
      }
    }

    try {
      await User.updateOne({ _id: req.user._id }, { $set: commonUpdates }, { runValidators: true });
    } catch (error) {
      if (error.code === 11000 && error.keyPattern?.username) {
        throw new ApiError(409, "This username is already taken.", {
          username: "This username is already taken.",
        });
      }
      throw error;
    }
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

function compactUpdate(value) {
  return Object.entries(value).reduce((updates, [key, entry]) => {
    if (entry !== undefined) updates[key] = entry;
    return updates;
  }, {});
}

export const getMyPrivacySettings = asyncHandler(async (req, res) => {
  const profile = await ensureRoleProfile(req.user);

  return sendResponse(res, 200, "Privacy settings fetched", {
    role: req.user.role,
    profileVisibility: profile.profileVisibility || (req.user.role === "creator" ? "public" : "private"),
    privacySettings: profile.privacySettings || {},
  });
});

export const updateMyPrivacySettings = asyncHandler(async (req, res) => {
  const updates = compactUpdate(validateSettingsPayload(req.user.role, "privacy", req.body));
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

export const getMyNotificationSettings = asyncHandler(async (req, res) => {
  const profile = await ensureRoleProfile(req.user);

  return sendResponse(res, 200, "Notification settings fetched", {
    role: req.user.role,
    notificationPreferences: profile.notificationPreferences || {},
  });
});

export const updateMyNotificationSettings = asyncHandler(async (req, res) => {
  const updates = compactUpdate(validateSettingsPayload(req.user.role, "notifications", req.body));
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
  const updates = compactUpdate(validateSettingsPayload(req.user.role, "account", req.body));
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

export const changeMyPassword = asyncHandler(async (req, res) => {
  const currentPassword = String(req.body.currentPassword || "");
  const newPassword = String(req.body.newPassword || "");

  if (!currentPassword || !newPassword) {
    throw new ApiError(400, "Current password and new password are required");
  }
  const validatedNewPassword = validatePasswordPolicy(newPassword, "New password");
  if (currentPassword === newPassword) {
    throw new ApiError(400, "New password must be different from the current password");
  }

  const user = await User.findById(req.user._id).select("+password");
  if (!user || !(await user.comparePassword(currentPassword))) {
    throw new ApiError(400, "Current password is incorrect");
  }

  user.password = validatedNewPassword;
  await user.save();
  await revokeAllUserRefreshSessions(user._id);
  return sendResponse(res, 200, "Password changed successfully");
});

export const uploadMyAvatar = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new ApiError(400, "Profile photo is required");
  }

  const storedFile = await storeFile(req.file, {
    folder: "onlyme/profiles/avatars",
    transformation: [
      { width: 512, height: 512, crop: "thumb", gravity: "face" },
      { quality: "auto", fetch_format: "auto" },
    ],
  });
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
  if (!["creator", "fan"].includes(req.user.role)) {
    throw new ApiError(403, "This role does not support cover photos");
  }

  if (!req.file) {
    throw new ApiError(400, "Cover photo is required");
  }

  const profile = await ensureRoleProfile(req.user);
  const oldCover = profile.coverPhoto;
  const storedFile = await storeFile(req.file, {
    folder: "onlyme/profiles/covers",
    transformation: [
      { width: 1600, height: 600, crop: "fill", gravity: "auto" },
      { quality: "auto", fetch_format: "auto" },
    ],
  });

  profile.coverPhoto = storedFile.url;
  await profile.save();

  if (oldCover && oldCover !== storedFile.url) {
    await deleteStoredFile(oldCover);
  }

  return sendResponse(res, 200, "Cover photo updated", serializeOwnProfile(req.user, profile));
});

export const removeMyCover = asyncHandler(async (req, res) => {
  if (!["creator", "fan"].includes(req.user.role)) {
    throw new ApiError(403, "This role does not support cover photos");
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
  const candidate = validateUsernameCandidate(req.query.username);
  if (!candidate.valid) {
    return sendResponse(res, 200, "Username availability checked", {
      username: candidate.username,
      available: false,
      reason: candidate.reason,
    });
  }

  const username = validateUsername(req.query.username);
  const currentUserId = req.user?._id ?? new mongoose.Types.ObjectId();
  const existingUser = await User.findOne({ username, _id: { $ne: currentUserId } }).select("_id");

  return sendResponse(res, 200, "Username availability checked", {
    username,
    available: !existingUser,
    reason: existingUser ? "taken" : null,
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

function locationFor(profile) {
  return [profile?.city, profile?.country].filter(Boolean).join(", ");
}

function viewerCapabilitiesFor({ owner = false, profile, user }) {
  const isCreator = user.role === "creator";
  return {
    isOwner: owner,
    canMessage: !owner && isCreator && profile?.messagingEnabled !== false,
    canDirectAccess: !owner && isCreator && Boolean(profile?.ppmEnabled),
    canSeePrivateContent: owner,
    canAccessStudio: owner && isCreator && user.creatorApprovalStatus === "approved",
  };
}

function serializeUnifiedProfile(user, profile) {
  const categories = profile?.categories?.length ? profile.categories : profile?.category ? [profile.category] : [];
  return {
    id: String(user._id),
    displayName: user.name,
    username: user.username,
    role: user.role,
    avatar: user.avatar || "",
    cover: profile?.coverPhoto || "",
    verified: Boolean(user.isVerified),
    creatorVerificationStatus: user.role === "creator" ? user.creatorApprovalStatus : null,
    bio: profile?.bio || "",
    orbitQuote: profile?.orbitQuote || "",
    messagingEnabled: profile?.messagingEnabled !== false,
    ppmEnabled: Boolean(profile?.ppmEnabled),
    ppmPrice: profile?.ppmPrice || 0,
    subscriptionPriceCents: profile?.subscriptionPriceCents || null,
    location: locationFor(profile),
    orbitStatus: profile?.orbitStatus || "",
    city: profile?.city || "",
    country: profile?.country || "",
    categories: user.role === "creator" ? categories : profile?.interests || [],
    socialLinks: user.role === "creator" ? profile?.socialLinks || [] : [],
    joinedAt: user.createdAt,
  };
}

async function buildUnifiedProfilePayload({ owner = false, user }) {
  const profile = await ensureRoleProfile(user);
  const publicContent = user.role === "creator"
    ? await Content.find({ creator: user._id, status: { $in: ["PUBLISHED", "published"] } })
        .sort({ publishedAt: -1 })
        .limit(20)
        .populate("creator", "name username avatar")
        .lean()
    : [];
  const [dream, supporterCount] = user.role === "creator"
    ? await Promise.all([
        OrbitDream.findOne({ user: user._id, visibility: "public", status: { $in: ["active", "completed"] } })
          .sort({ status: 1, updatedAt: -1 })
          .lean(),
        Subscription.countDocuments({ creator: user._id, status: "active" }),
      ])
    : [null, 0];

  const planets = user.role === "creator"
    ? (profile.categories?.length ? profile.categories : profile.category ? [profile.category] : []).map((category) => ({
        id: category,
        label: category,
      }))
    : (profile.interests || []).map((interest) => ({ id: interest, label: interest }));

  return {
    profile: serializeUnifiedProfile(user, profile),
    publicContent: publicContent.map((post) => serializeContent(post, null)),
    publicMetrics: {
      publishedContentCount: publicContent.length,
      supporterCount,
      worldCount: publicContent.length,
    },
    dream: dream ? {
      id: String(dream._id),
      title: dream.title,
      emoji: dream.emoji,
      status: dream.status,
      currentAmount: dream.currentAmount,
      goalAmount: dream.goalAmount,
      supporterCount: dream.supporterCount,
    } : null,
    viewerCapabilities: viewerCapabilitiesFor({ owner, profile, user }),
    profileCompletion: owner ? calculateCompletion(user, profile) : null,
    planets,
    seens: [],
  };
}

export const getUnifiedMyProfile = asyncHandler(async (req, res) => {
  const payload = await buildUnifiedProfilePayload({ owner: true, user: req.user });
  return sendResponse(res, 200, "Unified profile fetched", payload);
});

export const getUnifiedPublicProfile = asyncHandler(async (req, res) => {
  const username = normalizeUsername(req.params.username);
  const user = await User.findOne({
    username,
    role: { $in: ["fan", "creator"] },
    status: "active",
  });

  if (!user) {
    throw new ApiError(404, "Profile not found");
  }

  if (user.role === "creator" && user.creatorApprovalStatus !== "approved") {
    throw new ApiError(404, "Profile not found");
  }

  const profile = await ensureRoleProfile(user);
  if (profile.profileVisibility !== "public") {
    throw new ApiError(404, "Profile not found");
  }

  const payload = await buildUnifiedProfilePayload({ owner: false, user });
  return sendResponse(res, 200, "Unified profile fetched", payload);
});
