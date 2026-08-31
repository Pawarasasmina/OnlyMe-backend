import Content from "../models/Content.js";
import CreatorProfile from "../models/CreatorProfile.js";
import FanProfile from "../models/FanProfile.js";
import User from "../models/User.js";
import Publication from "../models/Publication.js";
import FeedPost from "../models/FeedPost.js";
import DreamGift from "../models/DreamGift.js";
import SeenEngagement from "../models/SeenEngagement.js";
import WallEngagement from "../models/WallEngagement.js";
import WallPost from "../models/WallPost.js";
import ProfileRelationship from "../models/ProfileRelationship.js";
import GroupConversation from "../models/GroupConversation.js";
import MessageReport from "../models/MessageReport.js";
import PremiumMembership from "../models/PremiumMembership.js";
import { serializeUnifiedProfile } from "../services/unifiedProfileService.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { normalizeUsername } from "../validators/profileValidator.js";
import { serializePost } from "./postController.js";
import { engagementForWallPost, engagementForWallShare } from "./wallController.js";

const profileModelFor = (owner) => owner.creatorApprovalStatus === "approved" || owner.role === "creator" ? CreatorProfile : FanProfile;

async function loadProfile(owner, viewer) {
  const Model = profileModelFor(owner);
  const publishedFilter = { creator: owner._id, status: { $in: ["PUBLISHED", "published"] } };
  const profileOwner = Boolean(viewer?._id && String(viewer._id) === String(owner._id));
  const seenStatus = { $in: ["PUBLISHED", "CHANGES_REQUESTED"] };
  const planetStatus = profileOwner ? { $in: ["DRAFT", "PENDING_REVIEW", "CHANGES_REQUESTED", "PUBLISHED"] } : { $in: ["PUBLISHED", "PENDING_REVIEW", "CHANGES_REQUESTED", "REJECTED"] };
  const [roleProfile, content, publishedContentCount, seens, planets, ownFeedPosts, shares, wallShares, feedSharePosts, followerCount, followingCount, supporterRows, viewerRelationships] = await Promise.all([
    Model.findOne({ user: owner._id }).lean(),
    Content.find(publishedFilter)
      .sort({ publishedAt: -1, _id: -1 }).limit(30).populate("creator", "name username avatar").lean(),
    Content.countDocuments(publishedFilter),
    Publication.find({ creator: owner._id, kind: "SEEN", status: seenStatus, publishedSnapshot: { $exists: true } }).select("+submittedSnapshot").sort({ publishedAt: -1, updatedAt: -1 }).populate("creator", "name username avatar").lean(),
    Publication.find({ creator: owner._id, kind: { $in: ["WORLD", "PREMIUM_WORLD"] }, status: planetStatus, ...(!profileOwner && { publishedSnapshot: { $exists: true } }) }).select("+submittedSnapshot").sort({ "planet.slot": 1 }).limit(3).populate("creator", "name username avatar").lean(),
    FeedPost.find({ author: owner._id, status: "published", visibility: "public", deletedAt: null }).sort({ publishedAt: -1, createdAt: -1 }).populate([{ path: "author", select: "name username avatar isVerified" }, { path: "comments.user", select: "name username avatar isVerified" }]).lean(),
    SeenEngagement.find({ user: owner._id, type: "SHARE" }).sort({ createdAt: -1 }).limit(30).select("publication text createdAt").lean(),
    WallEngagement.find({ user: owner._id, type: "SHARE" }).sort({ createdAt: -1 }).limit(30).select("post text createdAt").lean(),
    FeedPost.find({ status: "published", deletedAt: null, "shares.user": owner._id }).sort({ "shares.createdAt": -1 }).limit(30).populate([{ path: "author", select: "name username avatar isVerified" }, { path: "comments.user", select: "name username avatar isVerified" }, { path: "shares.user", select: "name username avatar isVerified role status" }]).lean(),
    ProfileRelationship.countDocuments({ target: owner._id, type: "FOLLOW" }),
    ProfileRelationship.countDocuments({ actor: owner._id, type: "FOLLOW" }),
    owner.role === "creator" ? DreamGift.distinct("supporter", { creator: owner._id }) : [],
    viewer?._id && String(viewer._id) !== String(owner._id) ? ProfileRelationship.find({ actor: viewer._id, target: owner._id }).select("type").lean() : [],
  ]);
  if (!roleProfile) throw new ApiError(404, "Profile not found");
  const sharedSeens = shares.length ? await Publication.find({ _id: { $in: shares.map((item) => item.publication) }, kind: "SEEN", status: "PUBLISHED" }).populate("creator", "name username avatar").lean() : [];
  const shareOrder = new Map(shares.map((item, index) => [String(item.publication), index]));
  const seenShareByPublication = new Map(shares.map((item) => [String(item.publication), item]));
  for (const seen of sharedSeens) {
    const share = seenShareByPublication.get(String(seen._id));
    seen.shareId = share?._id;
    seen.shareCaption = share?.text || "";
    seen.feedCreatedAt = share?.createdAt;
    seen.sharedBy = { id: owner._id, name: owner.name, username: owner.username, avatar: owner.avatar || "", verified: Boolean(owner.isVerified) };
  }
  sharedSeens.sort((left, right) => shareOrder.get(String(left._id)) - shareOrder.get(String(right._id)));
  const sharedWallPosts = wallShares.length ? await WallPost.find({ _id: { $in: wallShares.map((item) => item.post) }, status: "PUBLISHED" }).populate("creator", "name username avatar isVerified").lean() : [];
  const wallOrder = new Map(wallShares.map((item, index) => [String(item.post), index]));
  const wallCaptions = new Map(wallShares.map((item) => [String(item.post), item.text || ""]));
  const wallShareByPost = new Map(wallShares.map((item) => [String(item.post), item]));
  for (const post of sharedWallPosts) { const share = wallShareByPost.get(String(post._id)); post.shareCaption = wallCaptions.get(String(post._id)) || ""; post.shareId = share?._id; post.feedCreatedAt = share?.createdAt; }
  sharedWallPosts.sort((left, right) => wallOrder.get(String(left._id)) - wallOrder.get(String(right._id)));
  if (sharedWallPosts.length) {
    await Promise.all(sharedWallPosts.map(async (post) => { const original = await engagementForWallPost(post._id, viewer?._id); post.engagement = { ...(await engagementForWallShare(post.shareId, viewer?._id)), shareCount: original.shareCount, viewerShared: original.viewerShared }; }));
  }
  const sharedFeedPosts = feedSharePosts.flatMap((post) => (post.shares || [])
    .filter((share) => String(share.user?._id || share.user) === String(owner._id))
    .map((share) => serializePost(post, viewer, {
      feedId: `share-${share._id}`,
      shareId: String(share._id),
      feedCreatedAt: share.createdAt,
      shareCaption: share.caption || "",
      sharedBy: { id: owner._id, name: owner.name, username: owner.username, avatar: owner.avatar || "", verified: Boolean(owner.isVerified) },
    })));
  const pinnedMessageGroup = owner.pinnedMessageGroup ? await GroupConversation.findOne({ _id: owner.pinnedMessageGroup, members: owner._id, deletedAt: null }).select("name avatar members").lean() : null;
  const activePremiumMembership = viewer?._id && !profileOwner ? await PremiumMembership.findOne({
    user: viewer._id,
    creator: owner._id,
    status: { $in: ["ACTIVE", "CANCEL_AT_PERIOD_END"] },
    currentPeriodEnd: { $gt: new Date() },
  }).select("premiumPublication").lean() : null;
  const ownWallPosts = ownFeedPosts.map((post) => serializePost(post, viewer));
  const publicationPhotos = [...seens, ...planets].flatMap((publication) => [
    publication.coverMedia ? { ...publication.coverMedia, title: publication.title, publishedAt: publication.publishedAt } : null,
    publication.introMedia ? { ...publication.introMedia, title: publication.title, publishedAt: publication.publishedAt } : null,
  ]).filter(Boolean);
  const feedPhotos = ownFeedPosts.flatMap((post) => (post.media || []).map((media) => ({ ...media, url: media.url, caption: post.text, createdAt: post.createdAt })));
  const profilePhotos = [
    owner.avatar ? { url: owner.avatar, caption: "Profile photo", createdAt: owner.updatedAt } : null,
    roleProfile.coverPhoto ? { url: roleProfile.coverPhoto, caption: "Cover photo", createdAt: roleProfile.updatedAt } : null,
    ...publicationPhotos,
    ...feedPhotos,
  ].filter(Boolean);
  return serializeUnifiedProfile({ owner, roleProfile, content, photos: profilePhotos, pinnedMessageGroup, planets, premiumMembershipPublicationId: activePremiumMembership?.premiumPublication || null, publishedContentCount, seens, sharedSeens, sharedWallPosts: [...sharedFeedPosts, ...sharedWallPosts], ownWallPosts, supporterCount: supporterRows.length, viewer, followerCount, followingCount, viewerRelationships });
}

async function relationshipTarget(username) {
  const target = await User.findOne({ username: normalizeUsername(username), role: { $in: ["fan", "creator"] }, status: "active" }).select("_id");
  if (!target) throw new ApiError(404, "Profile not found");
  return target;
}

async function toggleRelationship(req, type) {
  if (!["fan", "creator"].includes(req.user.role)) throw new ApiError(403, "This action is available to fan and creator accounts");
  const target = await relationshipTarget(req.params.username);
  if (String(target._id) === String(req.user._id)) throw new ApiError(400, "You cannot use this action on your own profile");
  const filter = { actor: req.user._id, target: target._id, type };
  const existing = await ProfileRelationship.findOne(filter);
  if (existing) await existing.deleteOne();
  else await ProfileRelationship.create(filter);
  return { active: !existing, followerCount: await ProfileRelationship.countDocuments({ target: target._id, type: "FOLLOW" }) };
}

export const toggleProfileFollow = asyncHandler(async (req, res) => sendResponse(res, 200, "Follow relationship updated", { relationship: await toggleRelationship(req, "FOLLOW") }));
export const toggleProfileSeeSignal = asyncHandler(async (req, res) => sendResponse(res, 200, "See signal updated", { relationship: await toggleRelationship(req, "SEE_SIGNAL") }));

const PROFILE_REPORT_REASONS = new Set(["SPAM", "FALSE_INFORMATION", "HARASSMENT", "HATE", "NUDITY", "SEXUAL_CONTENT", "VIOLENCE", "ILLEGAL_CONTENT", "COPYRIGHT", "SCAM", "OTHER"]);

export const reportUnifiedProfile = asyncHandler(async (req, res) => {
  const username = normalizeUsername(req.params.username);
  const reportedUser = await User.findOne({ username }).select("name username avatar role");
  if (!reportedUser) throw new ApiError(404, "Profile not found");
  if (String(reportedUser._id) === String(req.user._id)) throw new ApiError(400, "You cannot report your own profile");
  const reason = String(req.body.reason || "").trim().toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_");
  if (!PROFILE_REPORT_REASONS.has(reason)) throw new ApiError(400, "Select a valid report reason");
  const details = String(req.body.details || "").trim().slice(0, 1000);
  try {
    const report = await MessageReport.create({
      reporter: req.user._id,
      reportedUser: reportedUser._id,
      scope: "PROFILE",
      reason,
      details,
      snapshot: { userId: String(reportedUser._id), username: reportedUser.username, name: reportedUser.name, avatar: reportedUser.avatar, role: reportedUser.role },
    });
    return sendResponse(res, 201, "Profile report received", { reportId: String(report._id), status: report.status });
  } catch (error) {
    if (error?.code === 11000) throw new ApiError(409, "You already reported this profile");
    throw error;
  }
});

export const getOwnUnifiedProfile = asyncHandler(async (req, res) => {
  if (!["fan", "creator"].includes(req.user.role)) throw new ApiError(404, "Profile not found");
  return sendResponse(res, 200, "Profile fetched", await loadProfile(req.user, req.user));
});

export const getOwnProfileViewers = asyncHandler(async (req, res) => {
  if (!["fan", "creator"].includes(req.user.role)) throw new ApiError(403, "Profile activity is available to fan and creator accounts");
  const limit = Math.min(30, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const [recentSignals, todaySignals] = await Promise.all([
    ProfileRelationship.find({ target: req.user._id, type: "SEE_SIGNAL" })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .populate({ path: "actor", match: { status: "active" }, select: "name username avatar isVerified role status" })
      .lean(),
    ProfileRelationship.find({ target: req.user._id, type: "SEE_SIGNAL", createdAt: { $gte: startOfToday } })
      .select("actor")
      .limit(500)
      .populate({ path: "actor", match: { status: "active" }, select: "_id" })
      .lean(),
  ]);
  const signals = recentSignals.flatMap((signal) => {
    if (!signal.actor) return [];
    return [{
      id: signal._id,
      type: "SEE_SIGNAL",
      description: "said \"I see you\"",
      createdAt: signal.createdAt,
      actor: {
        id: signal.actor._id,
        displayName: signal.actor.name,
        username: signal.actor.username,
        avatarUrl: signal.actor.avatar || "",
        verified: Boolean(signal.actor.isVerified),
        role: signal.actor.role,
      },
    }];
  });
  return sendResponse(res, 200, "Profile activity fetched", {
    seenTodayCount: todaySignals.filter((signal) => signal.actor).length,
    signals,
    worldVisitorCount: 0,
  });
});

export const getOwnProfileConnections = asyncHandler(async (req, res) => {
  const type = req.query.type;
  if (!["followers", "following", "supporters"].includes(type)) throw new ApiError(400, "Connection type must be followers, following, or supporters");

  return sendConnections({ owner: req.user, type, req, res });
});

async function sendConnections({ owner, type, req, res }) {
  if (type === "supporters" && owner.creatorApprovalStatus !== "approved") {
    return sendResponse(res, 200, "Profile connections fetched", { accounts: [], pagination: { page: 1, limit: 30, total: 0, hasMore: false } });
  }

  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 30));
  if (type === "supporters") {
    const supporterIds = await DreamGift.distinct("supporter", { creator: owner._id, privateSupport: false });
    const total = supporterIds.length;
    const pageIds = supporterIds.slice((page - 1) * limit, page * limit);
    const users = await User.find({ _id: { $in: pageIds }, status: "active" }).select("name username avatar isVerified role").lean();
    const byId = new Map(users.map((account) => [String(account._id), account]));
    const accounts = pageIds.flatMap((id) => {
      const account = byId.get(String(id));
      return account ? [{ id: account._id, name: account.name, username: account.username, avatar: account.avatar || "", verified: Boolean(account.isVerified), role: account.role }] : [];
    });
    return sendResponse(res, 200, "Profile connections fetched", { accounts, pagination: { page, limit, total, hasMore: page * limit < total } });
  }

  const userPath = type === "followers" ? "actor" : "target";
  const filter = type === "followers"
    ? { target: owner._id, type: "FOLLOW" }
    : { actor: owner._id, type: "FOLLOW" };
  const [relationships, total] = await Promise.all([
    ProfileRelationship.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({ path: userPath, match: { status: "active" }, select: "name username avatar isVerified role" })
      .lean(),
    ProfileRelationship.countDocuments(filter),
  ]);
  const accounts = relationships.flatMap((relationship) => {
    const account = relationship[userPath];
    return account ? [{ id: account._id, name: account.name, username: account.username, avatar: account.avatar || "", verified: Boolean(account.isVerified), role: account.role }] : [];
  });
  return sendResponse(res, 200, "Profile connections fetched", { accounts, pagination: { page, limit, total, hasMore: page * limit < total } });
}

export const getProfileConnections = asyncHandler(async (req, res) => {
  const type = req.query.type;
  if (!["followers", "following", "supporters"].includes(type)) throw new ApiError(400, "Connection type must be followers, following, or supporters");
  const owner = await User.findOne({ username: normalizeUsername(req.params.username), role: { $in: ["fan", "creator"] }, status: "active" });
  if (!owner) throw new ApiError(404, "Profile not found");
  return sendConnections({ owner, type, req, res });
});

export const getUnifiedProfileByUsername = asyncHandler(async (req, res) => {
  const username = normalizeUsername(req.params.username);
  const owner = await User.findOne({ username, role: { $in: ["fan", "creator"] }, status: "active" });
  if (!owner) throw new ApiError(404, "Profile not found");
  const Model = profileModelFor(owner);
  const visibility = await Model.findOne({ user: owner._id }).select("profileVisibility").lean();
  if (!visibility) throw new ApiError(404, "Profile not found");
  return sendResponse(res, 200, "Profile fetched", await loadProfile(owner, req.user || null));
});

export const getOrbitCreators = asyncHandler(async (req, res) => {
  const profiles = await CreatorProfile.find({ profileVisibility: "public" }).select("user city country bio coverPhoto").populate({ path: "user", match: { status: "active", role: { $in: ["fan", "creator"] }, creatorApprovalStatus: "approved" }, select: "name username avatar isVerified" }).sort({ updatedAt: -1 }).limit(24).lean();
  const visible = profiles.filter((profile) => profile.user && String(profile.user._id) !== String(req.user._id));
  const creatorIds = visible.map((profile) => profile.user._id);
  const publications = await Publication.find({ creator: { $in: creatorIds }, kind: { $in: ["WORLD", "PREMIUM_WORLD"] }, status: "PUBLISHED" }).select("creator kind title planet publishedAt").sort({ publishedAt: -1 }).lean();
  const planetsByCreator = new Map();
  for (const publication of publications) planetsByCreator.set(String(publication.creator), [...(planetsByCreator.get(String(publication.creator)) || []), { id: publication._id, kind: publication.kind, emoji: publication.planet?.emoji || (publication.kind === "PREMIUM_WORLD" ? "💠" : "🪐"), slot: publication.planet?.slot }]);
  const creators = visible.map((item) => ({ id: item.user._id, name: item.user.name, username: item.user.username, avatar: item.user.avatar || "", verified: Boolean(item.user.isVerified), location: [item.city, item.country].filter(Boolean).join(", "), bio: item.bio || "", cover: item.coverPhoto || "", planets: (planetsByCreator.get(String(item.user._id)) || []).slice(0, 3) }));
  return sendResponse(res, 200, "Orbit creators fetched", { creators });
});
