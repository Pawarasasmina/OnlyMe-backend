import Content from "../models/Content.js";
import CreatorProfile from "../models/CreatorProfile.js";
import FanProfile from "../models/FanProfile.js";
import User from "../models/User.js";
import Publication from "../models/Publication.js";
import SeenEngagement from "../models/SeenEngagement.js";
import WallEngagement from "../models/WallEngagement.js";
import WallPost from "../models/WallPost.js";
import ProfileRelationship from "../models/ProfileRelationship.js";
import { serializeUnifiedProfile } from "../services/unifiedProfileService.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { normalizeUsername } from "../validators/profileValidator.js";

const profileModelFor = (role) => role === "creator" ? CreatorProfile : FanProfile;

async function loadProfile(owner, viewer) {
  const Model = profileModelFor(owner.role);
  const publishedFilter = { creator: owner._id, status: { $in: ["PUBLISHED", "published"] } };
  const profileOwner = Boolean(viewer?._id && String(viewer._id) === String(owner._id));
  const planetStatus = profileOwner ? { $in: ["DRAFT", "PENDING_REVIEW", "CHANGES_REQUESTED", "PUBLISHED"] } : "PUBLISHED";
  const [roleProfile, content, publishedContentCount, seens, planets, shares, wallShares, followerCount, followingCount, viewerRelationships] = await Promise.all([
    Model.findOne({ user: owner._id }).lean(),
    Content.find(publishedFilter)
      .sort({ publishedAt: -1, _id: -1 }).limit(30).populate("creator", "name username avatar").lean(),
    Content.countDocuments(publishedFilter),
    Publication.find({ creator: owner._id, kind: "SEEN", status: "PUBLISHED" }).sort({ publishedAt: -1 }).limit(30).populate("creator", "name username avatar").lean(),
    Publication.find({ creator: owner._id, kind: { $in: ["WORLD", "PREMIUM_WORLD"] }, status: planetStatus }).select("+submittedSnapshot").sort({ "planet.slot": 1 }).limit(3).populate("creator", "name username avatar").lean(),
    SeenEngagement.find({ user: owner._id, type: "SHARE" }).sort({ createdAt: -1 }).limit(30).select("publication text").lean(),
    WallEngagement.find({ user: owner._id, type: "SHARE" }).sort({ createdAt: -1 }).limit(30).select("post text").lean(),
    ProfileRelationship.countDocuments({ target: owner._id, type: "FOLLOW" }),
    ProfileRelationship.countDocuments({ actor: owner._id, type: "FOLLOW" }),
    viewer?._id && String(viewer._id) !== String(owner._id) ? ProfileRelationship.find({ actor: viewer._id, target: owner._id }).select("type").lean() : [],
  ]);
  if (!roleProfile) throw new ApiError(404, "Profile not found");
  const sharedSeens = shares.length ? await Publication.find({ _id: { $in: shares.map((item) => item.publication) }, kind: "SEEN", status: "PUBLISHED" }).populate("creator", "name username avatar").lean() : [];
  const shareOrder = new Map(shares.map((item, index) => [String(item.publication), index]));
  const seenCaptions = new Map(shares.map((item) => [String(item.publication), item.text || ""]));
  for (const seen of sharedSeens) seen.shareCaption = seenCaptions.get(String(seen._id)) || "";
  sharedSeens.sort((left, right) => shareOrder.get(String(left._id)) - shareOrder.get(String(right._id)));
  const sharedWallPosts = wallShares.length ? await WallPost.find({ _id: { $in: wallShares.map((item) => item.post) }, status: "PUBLISHED" }).populate("creator", "name username avatar isVerified").lean() : [];
  const wallOrder = new Map(wallShares.map((item, index) => [String(item.post), index]));
  const wallCaptions = new Map(wallShares.map((item) => [String(item.post), item.text || ""]));
  for (const post of sharedWallPosts) post.shareCaption = wallCaptions.get(String(post._id)) || "";
  sharedWallPosts.sort((left, right) => wallOrder.get(String(left._id)) - wallOrder.get(String(right._id)));
  if (sharedWallPosts.length) {
    const postIds = sharedWallPosts.map((item) => item._id);
    const [counts, viewerEngagement] = await Promise.all([
      WallEngagement.aggregate([{ $match: { post: { $in: postIds } } }, { $group: { _id: { post: "$post", type: "$type" }, count: { $sum: 1 } } }]),
      viewer?._id ? WallEngagement.find({ post: { $in: postIds }, user: viewer._id, type: { $in: ["REACTION", "SHARE", "SAVE"] } }).select("post type").lean() : [],
    ]);
    const countMap = new Map(counts.map((item) => [`${item._id.post}:${item._id.type}`, item.count]));
    const viewerMap = new Set(viewerEngagement.map((item) => `${item.post}:${item.type}`));
    for (const post of sharedWallPosts) post.engagement = {
      reactionCount: countMap.get(`${post._id}:REACTION`) || 0,
      commentCount: countMap.get(`${post._id}:COMMENT`) || 0,
      shareCount: countMap.get(`${post._id}:SHARE`) || 0,
      saveCount: countMap.get(`${post._id}:SAVE`) || 0,
      viewerReacted: viewerMap.has(`${post._id}:REACTION`),
      viewerShared: viewerMap.has(`${post._id}:SHARE`),
      viewerSaved: viewerMap.has(`${post._id}:SAVE`),
    };
  }
  return serializeUnifiedProfile({ owner, roleProfile, content, planets, publishedContentCount, seens, sharedSeens, sharedWallPosts, viewer, followerCount, followingCount, viewerRelationships });
}

async function relationshipTarget(username) {
  const target = await User.findOne({ username: normalizeUsername(username), role: "creator", status: "active", creatorApprovalStatus: "approved" }).select("_id");
  if (!target) throw new ApiError(404, "Creator profile not found");
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

export const getOwnUnifiedProfile = asyncHandler(async (req, res) => {
  if (!["fan", "creator"].includes(req.user.role)) throw new ApiError(404, "Profile not found");
  return sendResponse(res, 200, "Profile fetched", await loadProfile(req.user, req.user));
});

export const getUnifiedProfileByUsername = asyncHandler(async (req, res) => {
  const username = normalizeUsername(req.params.username);
  const owner = await User.findOne({ username, role: { $in: ["fan", "creator"] }, status: "active" });
  if (!owner) throw new ApiError(404, "Profile not found");
  const isOwner = Boolean(req.user?._id && String(req.user._id) === String(owner._id));
  const Model = profileModelFor(owner.role);
  const visibility = await Model.findOne({ user: owner._id }).select("profileVisibility").lean();
  if (!visibility || (!isOwner && visibility.profileVisibility !== "public")) throw new ApiError(404, "Profile not found");
  if (!isOwner && owner.role === "creator" && owner.creatorApprovalStatus !== "approved") throw new ApiError(404, "Profile not found");
  return sendResponse(res, 200, "Profile fetched", await loadProfile(owner, req.user || null));
});

export const getOrbitCreators = asyncHandler(async (req, res) => {
  const profiles = await CreatorProfile.find({ profileVisibility: "public" }).select("user city country bio coverPhoto").populate({ path: "user", match: { status: "active", role: "creator", creatorApprovalStatus: "approved" }, select: "name username avatar isVerified" }).sort({ updatedAt: -1 }).limit(24).lean();
  const visible = profiles.filter((profile) => profile.user && String(profile.user._id) !== String(req.user._id));
  const creatorIds = visible.map((profile) => profile.user._id);
  const publications = await Publication.find({ creator: { $in: creatorIds }, kind: { $in: ["WORLD", "PREMIUM_WORLD"] }, status: "PUBLISHED" }).select("creator kind title planet publishedAt").sort({ publishedAt: -1 }).lean();
  const planetsByCreator = new Map();
  for (const publication of publications) planetsByCreator.set(String(publication.creator), [...(planetsByCreator.get(String(publication.creator)) || []), { id: publication._id, kind: publication.kind, emoji: publication.planet?.emoji || (publication.kind === "PREMIUM_WORLD" ? "💠" : "🪐"), slot: publication.planet?.slot }]);
  const creators = visible.map((item) => ({ id: item.user._id, name: item.user.name, username: item.user.username, avatar: item.user.avatar || "", verified: Boolean(item.user.isVerified), location: [item.city, item.country].filter(Boolean).join(", "), bio: item.bio || "", cover: item.coverPhoto || "", planets: (planetsByCreator.get(String(item.user._id)) || []).slice(0, 3) }));
  return sendResponse(res, 200, "Orbit creators fetched", { creators });
});
