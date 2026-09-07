import mongoose from "mongoose";
import CreatorProfile from "../models/CreatorProfile.js";
import ProfileRelationship from "../models/ProfileRelationship.js";
import User from "../models/User.js";
import UserBlock from "../models/UserBlock.js";
import ApiError from "../utils/ApiError.js";

const FOLLOW_TYPE = "FOLLOW";

function objectId(value) {
  return value instanceof mongoose.Types.ObjectId ? value : new mongoose.Types.ObjectId(value);
}

function objectIdList(values = []) {
  return values.filter((value) => mongoose.isValidObjectId(value)).map(objectId);
}

function userIdString(value) {
  return String(value?._id || value || "");
}

function locationFor(profile = {}) {
  if (profile.privacySettings?.showLocation === false) return "";
  return [profile.city, profile.country].filter(Boolean).join(", ");
}

function activeStatusFor(user = {}) {
  if (!user.activeStatus?.isActive) return null;
  return {
    emoji: user.activeStatus.emoji || "",
    label: user.activeStatus.label || "",
    color: user.activeStatus.color || "",
    presetKey: user.activeStatus.presetKey || "",
    startedAt: user.activeStatus.startedAt || null,
    expiresAt: user.activeStatus.expiresAt || null,
  };
}

export function serializeFollowedCreator({ followerCount = 0, profile = {}, relationship = {}, user = {} }) {
  const categories = profile.categories?.length ? profile.categories : profile.category ? [profile.category] : [];
  const id = userIdString(user);
  return {
    id,
    relationshipId: String(relationship._id || ""),
    username: user.username || "",
    displayName: user.name || user.username || "Creator",
    name: user.name || user.username || "Creator",
    avatar: user.avatar || "",
    profilePhoto: user.avatar || "",
    role: user.role || "creator",
    category: profile.category || categories[0] || "Creator",
    categories,
    location: locationFor(profile),
    bio: profile.bio || profile.orbitQuote || "",
    status: activeStatusFor(user) || profile.orbitStatus || "",
    activeStatus: activeStatusFor(user),
    isVerified: Boolean(user.isVerified),
    verified: Boolean(user.isVerified),
    isFollowing: true,
    following: true,
    followersCount: Number(followerCount) || 0,
    followers: Number(followerCount) || 0,
    followedAt: relationship.createdAt || null,
    profileUrl: user.username ? `/profile/${encodeURIComponent(user.username)}` : "/search",
  };
}

export async function blockedUserIdsFor(userId) {
  const blocks = await UserBlock.find({ $or: [{ blocker: userId }, { blocked: userId }] }).select("blocker blocked").lean();
  return blocks.map((block) => String(block.blocker) === String(userId) ? block.blocked : block.blocker);
}

function followedCreatorAggregation({ blockedIds = [], userId }) {
  const excludedTargets = objectIdList([userId, ...blockedIds]);
  return [
    {
      $match: {
        actor: objectId(userId),
        type: FOLLOW_TYPE,
        ...(excludedTargets.length ? { target: { $nin: excludedTargets } } : {}),
      },
    },
    {
      $lookup: {
        from: User.collection.name,
        localField: "target",
        foreignField: "_id",
        as: "targetUser",
      },
    },
    { $unwind: "$targetUser" },
    {
      $match: {
        "targetUser.role": { $in: ["fan", "creator"] },
        "targetUser.status": "active",
        "targetUser.creatorApprovalStatus": "approved",
      },
    },
    {
      $lookup: {
        from: CreatorProfile.collection.name,
        localField: "target",
        foreignField: "user",
        as: "creatorProfile",
      },
    },
    { $unwind: "$creatorProfile" },
    { $match: { "creatorProfile.profileVisibility": "public" } },
  ];
}

export async function countFollowedCreators(userId, blockedIds = []) {
  const rows = await ProfileRelationship.aggregate([
    ...followedCreatorAggregation({ blockedIds, userId }),
    { $count: "total" },
  ]);
  return rows[0]?.total || 0;
}

async function followerCountsByTarget(targetIds = []) {
  if (!targetIds.length) return new Map();
  const rows = await ProfileRelationship.aggregate([
    { $match: { target: { $in: targetIds.map(objectId) }, type: FOLLOW_TYPE } },
    { $group: { _id: "$target", count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
}

export async function listFollowedCreators(userId, { blockedIds = [], limit = 20, offset = 0, page = 1 } = {}) {
  const [rows, totalRows] = await Promise.all([
    ProfileRelationship.aggregate([
      ...followedCreatorAggregation({ blockedIds, userId }),
      { $sort: { createdAt: -1, _id: -1 } },
      { $skip: offset },
      { $limit: limit },
      { $project: { _id: 1, createdAt: 1, targetUser: 1, creatorProfile: 1 } },
    ]),
    ProfileRelationship.aggregate([
      ...followedCreatorAggregation({ blockedIds, userId }),
      { $count: "total" },
    ]),
  ]);
  const targetIds = rows.map((row) => row.targetUser._id);
  const followerCounts = await followerCountsByTarget(targetIds);
  const total = totalRows[0]?.total || 0;
  const items = rows.map((row) => serializeFollowedCreator({
    followerCount: followerCounts.get(String(row.targetUser._id)) || 0,
    profile: row.creatorProfile,
    relationship: row,
    user: row.targetUser,
  }));
  return {
    items,
    total,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      hasMore: offset + items.length < total,
    },
  };
}

export async function toggleFollowRelationship({ actor, targetUsername }) {
  if (!["fan", "creator"].includes(actor?.role)) throw new ApiError(403, "This action is available to fan and creator accounts");
  const target = await User.findOne({
    username: String(targetUsername || "").toLowerCase(),
    role: { $in: ["fan", "creator"] },
    status: "active",
  }).select("_id username role status creatorApprovalStatus");
  if (!target) throw new ApiError(404, "Profile not found");
  if (String(target._id) === String(actor._id)) throw new ApiError(400, "You cannot use this action on your own profile");

  const blockedIds = await blockedUserIdsFor(actor._id);
  if (blockedIds.some((id) => String(id) === String(target._id))) throw new ApiError(403, "This profile is unavailable");

  const filter = { actor: actor._id, target: target._id, type: FOLLOW_TYPE };
  const existing = await ProfileRelationship.findOne(filter);
  if (existing) {
    await existing.deleteOne();
  } else {
    try {
      await ProfileRelationship.updateOne(filter, { $setOnInsert: filter }, { upsert: true });
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
  }
  return {
    active: !existing,
    followerCount: await ProfileRelationship.countDocuments({ target: target._id, type: FOLLOW_TYPE }),
    targetUserId: String(target._id),
    username: target.username,
  };
}

export async function createFollowRelationship({ actor, targetUserId }) {
  if (!["fan", "creator"].includes(actor?.role)) throw new ApiError(403, "This action is available to fan and creator accounts");
  if (!mongoose.isValidObjectId(targetUserId)) throw new ApiError(400, "Invalid target user ID");
  if (String(actor._id) === String(targetUserId)) throw new ApiError(400, "You cannot follow yourself");

  const [target, blockedIds] = await Promise.all([
    User.findOne({ _id: targetUserId, role: { $in: ["fan", "creator"] }, status: "active" }).select("_id username role status creatorApprovalStatus").lean(),
    blockedUserIdsFor(actor._id),
  ]);
  if (!target) throw new ApiError(404, "Profile not found");
  if (blockedIds.some((id) => String(id) === String(target._id))) throw new ApiError(403, "This profile is unavailable");

  const filter = { actor: actor._id, target: target._id, type: FOLLOW_TYPE };
  await ProfileRelationship.updateOne(filter, { $setOnInsert: filter }, { upsert: true });
  return {
    active: true,
    targetUserId: String(target._id),
    username: target.username,
  };
}

export const profileRelationshipServiceTestUtils = {
  createFollowRelationship,
  FOLLOW_TYPE,
  followedCreatorAggregation,
  locationFor,
  serializeFollowedCreator,
};
