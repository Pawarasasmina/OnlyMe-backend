import mongoose from "mongoose";
import Story from "../models/Story.js";
import StoryEngagement from "../models/StoryEngagement.js";
import ProfileRelationship from "../models/ProfileRelationship.js";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import User from "../models/User.js";
import UserBlock from "../models/UserBlock.js";
import { storeFile, deleteAsset } from "../services/storageService.js";
import { parseStoryEditorMetadata, parseStoryOptions } from "../services/storyMetadataService.js";
import { buildStatusFromPayload, serializeStatus } from "../services/statusService.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

const activeStory = async (id) => {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(400, "Invalid story ID");
  const story = await Story.findOne({ _id: id, expiresAt: { $gt: new Date() } });
  if (!story) throw new ApiError(404, "Story has expired or is unavailable");
  return story;
};

const followedStory = async (id, fanId) => {
  const story = await activeStory(id);
  if (String(story.creator) === String(fanId)) return story;
  const blocked = await UserBlock.exists({ $or: [{ blocker: fanId, blocked: story.creator }, { blocker: story.creator, blocked: fanId }] });
  if (blocked || story.audience === "only_me") throw new ApiError(403, "This story is unavailable");
  if (story.audience === "everyone" || !story.audience) return story;
  const follows = await ProfileRelationship.exists({ actor: fanId, target: story.creator, type: "FOLLOW" });
  if (!follows) throw new ApiError(403, "Follow this creator to view their story");
  if (story.audience === "close_circle") {
    const followsBack = await ProfileRelationship.exists({ actor: story.creator, target: fanId, type: "FOLLOW" });
    if (!followsBack) throw new ApiError(403, "This story is available to the creator's close circle");
  }
  return story;
};

const timeAgo = (value) => {
  const created = new Date(value).getTime();
  if (!created) return "Now";
  const minutes = Math.max(0, Math.floor((Date.now() - created) / 60000));
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
};

const readMediaType = (file, value) => {
  const requested = String(value || "").trim().toLowerCase();
  if (requested === "video" || String(file?.mimetype || "").startsWith("video/")) return "video";
  return "image";
};

const readDuration = (value, mediaType) => {
  const fallback = mediaType === "video" ? 15 : 5;
  const duration = Number(value) || fallback;
  return Math.max(1, Math.min(60, duration));
};

const defaultEditorMetadata = () => ({
  transform: { scale: 1, translateX: 0, translateY: 0, rotation: 0 },
  textOverlays: [],
  stickers: [],
  drawing: [],
});

const serializeUser = (user) => ({
  id: String(user?._id || user?.id || ""),
  name: user?.name || "Account",
  firstName: String(user?.name || "Account").split(" ").filter(Boolean)[0] || "Account",
  username: user?.username || "",
  avatarUrl: user?.avatar || "",
  avatar: user?.avatar || "",
  verified: Boolean(user?.isVerified),
  role: user?.role || "",
});

const statusActivityTime = (status) => status?.startedAt || status?.expiresAt || null;

const recentTime = (values) => Math.max(0, ...values.filter(Boolean).map((value) => new Date(value).getTime() || 0));

const serialize = (story, viewer, engagement, insights = null) => {
  const rawCreatorId = story.creator?._id || story.creator;
  const creatorId = String(rawCreatorId || "");
  const owner = {
    id: creatorId,
    name: story.creator?.name || "Creator",
    username: story.creator?.username,
    avatar: story.creator?.avatar || story.image.url,
    verified: Boolean(story.creator?.isVerified),
    role: story.creator?.creatorApprovalStatus === "approved" ? "creator" : "fan",
  };

  return {
    id: story._id,
    ownerId: creatorId,
    creatorId,
    owner,
    name: owner.name,
    username: owner.username,
    avatar: owner.avatar,
    verified: owner.verified,
    image: story.image.url,
    mediaUrl: story.image.url,
    thumbnailUrl: story.image.url,
    mediaType: story.mediaType || "image",
    duration: story.duration || (story.mediaType === "video" ? 15 : 5),
    editorMetadata: story.editorMetadata || defaultEditorMetadata(),
    audience: story.audience || "everyone",
    allowReactions: story.allowReactions !== false,
    allowReplies: story.allowReplies !== false,
    allowSharing: story.allowSharing !== false,
    caption: story.caption,
    createdAt: story.createdAt,
    expiresAt: story.expiresAt,
    timeAgo: timeAgo(story.createdAt),
    isOwn: Boolean(viewer && String(creatorId) === String(viewer)),
    viewed: Boolean(engagement?.viewedAt),
    viewerReaction: engagement?.reaction || null,
    ...(insights ? { insights } : {}),
  };
};

export const getStory = asyncHandler(async (req, res) => {
  const story = await followedStory(req.params.id, req.user._id);
  await story.populate("creator", "name username avatar isVerified");
  return sendResponse(res, 200, "Story fetched", { story: serialize(story, req.user._id) });
});

export const getStoryInsights = asyncHandler(async (req, res) => {
  const story = await activeStory(req.params.id);
  if (String(story.creator) !== String(req.user._id)) throw new ApiError(403, "Only the story creator can view insights");
  const [engagements, replies] = await Promise.all([
    StoryEngagement.find({ story: story._id, viewedAt: { $ne: null } }).populate("fan", "name username avatar isVerified").lean(),
    Message.countDocuments({ "storyReply.story": story._id }),
  ]);
  const viewers = engagements.filter((item) => item.fan).map((item) => ({
    id: item.fan._id,
    name: item.fan.name,
    username: item.fan.username,
    avatar: item.fan.avatar || "",
    verified: Boolean(item.fan.isVerified),
    viewedAt: item.viewedAt,
    reaction: item.reaction || null,
    reactedAt: item.reaction ? item.updatedAt : null,
  })).sort((left, right) => Number(Boolean(right.reaction)) - Number(Boolean(left.reaction)) || new Date(right.reactedAt || right.viewedAt) - new Date(left.reactedAt || left.viewedAt));
  const reactionMap = new Map();
  for (const viewer of viewers) if (viewer.reaction) reactionMap.set(viewer.reaction, (reactionMap.get(viewer.reaction) || 0) + 1);
  return sendResponse(res, 200, "Story insights fetched", {
    storyId: story._id,
    totalViews: viewers.length,
    uniqueViewers: viewers.length,
    reactionTotal: viewers.filter((viewer) => viewer.reaction).length,
    reactions: [...reactionMap].map(([reaction, count]) => ({ reaction, count })).sort((left, right) => right.count - left.count),
    replies,
    shares: 0,
    viewers,
  });
});

export const createStory = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, "Story media is required");
  const caption = String(req.body.caption || "").trim();
  if (caption.length > 300) throw new ApiError(400, "Story caption may contain at most 300 characters");
  const mediaType = readMediaType(req.file, req.body.mediaType);
  const duration = readDuration(req.body.duration, mediaType);
  const editorMetadata = parseStoryEditorMetadata(req.body.editorMetadata);
  const options = parseStoryOptions(req.body);
  const stored = await storeFile(req.file, { folder: `onlyme/stories/${req.user._id}`, resourceType: mediaType === "video" ? "video" : "image" });
  const story = await Story.create({
    creator: req.user._id,
    caption,
    image: { assetId: stored.id, url: stored.url, resourceType: stored.resourceType },
    mediaType,
    duration,
    editorMetadata,
    ...options,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  await story.populate("creator", "name username avatar isVerified");
  return sendResponse(res, 201, "Story is live for 24 hours", { story: serialize(story, req.user._id) });
});

export const listStories = asyncHandler(async (req, res) => {
  const now = new Date();
  const [follows, followsBack, blocks] = await Promise.all([
    ProfileRelationship.find({ actor: req.user._id, type: "FOLLOW" }).select("target").lean(),
    ProfileRelationship.find({ target: req.user._id, type: "FOLLOW" }).select("actor").lean(),
    UserBlock.find({ $or: [{ blocker: req.user._id }, { blocked: req.user._id }] }).select("blocker blocked").lean(),
  ]);
  const viewerId = String(req.user._id);
  const blockedIds = new Set(blocks.map((item) => (String(item.blocker) === viewerId ? String(item.blocked) : String(item.blocker))));
  const followedIds = follows.map((item) => item.target).filter((id) => !blockedIds.has(String(id)));
  const followedSet = new Set(followedIds.map(String));
  const followsBackIds = new Set(followsBack.map((item) => String(item.actor)));
  const closeCircleIds = followedIds.filter((id) => followsBackIds.has(String(id)));
  const creatorFilter = {
    creator: { $nin: [...blockedIds] },
    $or: [
      { creator: req.user._id },
      { audience: "everyone" },
      { audience: { $exists: false } },
      { audience: "followers", creator: { $in: followedIds } },
      { audience: "close_circle", creator: { $in: closeCircleIds } },
    ],
  };
  const rawStories = await Story.find({ expiresAt: { $gt: now }, ...creatorFilter }).sort({ createdAt: 1 }).populate("creator", "name username avatar isVerified role creatorApprovalStatus status activeStatus lastSeenAt").lean();
  const stories = rawStories.filter((story) => story.creator && story.creator.status === "active");
  const storyIds = stories.map((item) => item._id);
  const engagements = await StoryEngagement.find({ fan: req.user._id, story: { $in: storyIds } }).lean();
  const byStory = new Map(engagements.map((item) => [String(item.story), item]));
  const ownStoryIds = stories.filter((story) => String(story.creator?._id) === String(req.user._id)).map((story) => story._id);
  const creatorEngagements = await StoryEngagement.find({ story: { $in: ownStoryIds } }).populate("fan", "name username avatar").sort({ updatedAt: -1 }).lean();
  const insightsByStory = new Map();
  for (const item of creatorEngagements) {
    const key = String(item.story);
    const insights = insightsByStory.get(key) || { viewCount: 0, reactions: [], viewers: [] };
    if (item.viewedAt) {
      insights.viewCount += 1;
      if (item.fan) insights.viewers.push({ id: item.fan._id, name: item.fan.name, username: item.fan.username, avatar: item.fan.avatar || "", reaction: item.reaction || null, viewedAt: item.viewedAt, reactedAt: item.reaction ? item.updatedAt : null });
    }
    if (item.reaction && item.fan) insights.reactions.push({ fan: { id: item.fan._id, name: item.fan.name, username: item.fan.username, avatar: item.fan.avatar || "" }, reaction: item.reaction, reactedAt: item.updatedAt });
    insightsByStory.set(key, insights);
  }
  for (const insights of insightsByStory.values()) insights.viewers.sort((left, right) => Number(Boolean(right.reaction)) - Number(Boolean(left.reaction)) || new Date(right.reactedAt || right.viewedAt) - new Date(left.reactedAt || left.viewedAt));

  const viewerStories = [];
  const groups = new Map();

  for (const story of stories) {
    const serialized = serialize(story, req.user._id, byStory.get(String(story._id)), insightsByStory.get(String(story._id)));
    const creatorId = String(story.creator?._id || story.creator || "");
    if (creatorId === viewerId) {
      viewerStories.push(serialized);
      continue;
    }
    if (!groups.has(creatorId)) {
      groups.set(creatorId, {
        user: serializeUser(story.creator),
        stories: [],
        hasUnseenStories: false,
        activeStatus: serializeStatus(story.creator.activeStatus),
        presence: { isOnline: false, lastActiveAt: story.creator.lastSeenAt || null },
        followed: followedSet.has(creatorId),
        latestActivityAt: null,
      });
    }
    const group = groups.get(creatorId);
    group.stories.push(serialized);
    group.hasUnseenStories = group.hasUnseenStories || !serialized.viewed;
    group.latestActivityAt = new Date(Math.max(recentTime([group.latestActivityAt, story.createdAt, statusActivityTime(story.creator.activeStatus), story.creator.lastSeenAt]))).toISOString();
  }

  const statusUsers = await User.find({
    _id: { $nin: [req.user._id, ...[...blockedIds].filter((id) => mongoose.isValidObjectId(id))] },
    role: { $in: ["fan", "creator"] },
    status: "active",
    "activeStatus.isActive": true,
    "activeStatus.expiresAt": { $gt: now },
  }).select("name username avatar isVerified role activeStatus lastSeenAt").limit(80).lean();

  for (const person of statusUsers) {
    const personId = String(person._id);
    const activeStatus = serializeStatus(person.activeStatus);
    if (!activeStatus) continue;
    if (!groups.has(personId)) {
      groups.set(personId, {
        user: serializeUser(person),
        stories: [],
        hasUnseenStories: false,
        activeStatus,
        presence: { isOnline: false, lastActiveAt: person.lastSeenAt || null },
        followed: followedSet.has(personId),
        latestActivityAt: new Date(recentTime([statusActivityTime(person.activeStatus), person.lastSeenAt])).toISOString(),
      });
      continue;
    }
    const group = groups.get(personId);
    group.activeStatus = group.activeStatus || activeStatus;
    group.latestActivityAt = new Date(Math.max(recentTime([group.latestActivityAt, statusActivityTime(person.activeStatus), person.lastSeenAt]))).toISOString();
  }

  const items = [...groups.values()]
    .filter((item) => item.stories.length || item.activeStatus || item.presence?.isOnline)
    .map((item) => ({
      ...item,
      storyCount: item.stories.length,
      latestStoryAt: item.stories[item.stories.length - 1]?.createdAt || null,
    }))
    .sort((left, right) => Number(right.hasUnseenStories) - Number(left.hasUnseenStories)
      || Number(right.followed) - Number(left.followed)
      || Number(Boolean(right.activeStatus)) - Number(Boolean(left.activeStatus))
      || recentTime([right.latestActivityAt]) - recentTime([left.latestActivityAt])
      || recentTime([right.latestStoryAt]) - recentTime([left.latestStoryAt]))
    .map(({ followed: _followed, latestActivityAt: _latestActivityAt, latestStoryAt: _latestStoryAt, ...item }) => item);

  viewerStories.sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt));

  return sendResponse(res, 200, "Wall stories fetched", {
    viewer: {
      ...serializeUser(req.user),
      activeStatus: serializeStatus(req.user.activeStatus),
      hasActiveStories: viewerStories.length > 0,
      storyCount: viewerStories.length,
      stories: viewerStories,
      presence: { isOnline: false, lastActiveAt: req.user.lastSeenAt || null },
    },
    items,
  });
});

export const updateStoryStatus = asyncHandler(async (req, res) => {
  const currentStatus = serializeStatus(req.user.activeStatus);
  const { activeStatus, cleared } = buildStatusFromPayload(req.body, currentStatus);
  req.user.activeStatus = activeStatus;
  await req.user.save();
  return sendResponse(res, 200, cleared ? "Status cleared" : "Status updated", { activeStatus: serializeStatus(req.user.activeStatus) });
});

export const viewStory = asyncHandler(async (req, res) => {
  await followedStory(req.params.id, req.user._id);
  await StoryEngagement.findOneAndUpdate({ story: req.params.id, fan: req.user._id }, { $set: { viewedAt: new Date() } }, { upsert: true, new: true });
  return sendResponse(res, 200, "Story viewed", { storyId: req.params.id, viewed: true });
});

export const reactStory = asyncHandler(async (req, res) => {
  const story = await followedStory(req.params.id, req.user._id);
  if (story.allowReactions === false) throw new ApiError(403, "Reactions are disabled for this story");
  const reaction = String(req.body.reaction || "").trim();
  if (!reaction || reaction.length > 12) throw new ApiError(400, "A valid reaction is required");
  const engagement = await StoryEngagement.findOneAndUpdate(
    { story: story._id, fan: req.user._id },
    { $set: { reaction, viewedAt: new Date() } },
    { upsert: true, new: true },
  );
  return sendResponse(res, 200, "Reaction sent", { reaction: engagement.reaction, reactedAt: engagement.updatedAt });
});

export const replyStory = asyncHandler(async (req, res) => {
  const story = await followedStory(req.params.id, req.user._id);
  if (story.allowReplies === false) throw new ApiError(403, "Replies are disabled for this story");
  const body = String(req.body.body || "").trim();
  if (!body) throw new ApiError(400, "Reply text is required");
  if (body.length > 1000) throw new ApiError(400, "Story reply must be 1,000 characters or fewer");
  const conversation = await Conversation.findOneAndUpdate({ fan: req.user._id, creator: story.creator }, { $set: { status: "ACTIVE", declinedAt: null }, $setOnInsert: { fan: req.user._id, creator: story.creator, acceptedAt: new Date(), acceptedByCreator: false } }, { new: true, upsert: true });
  const storyReply = { story: story._id, imageUrl: story.image.url, caption: story.caption, expiresAt: story.expiresAt };
  const created = await Message.create({ sender: req.user._id, recipient: story.creator, body, mediaType: "text", ppm: false, storyReply });
  const serializedReply = { storyId: String(story._id), imageUrl: story.image.url, caption: story.caption, expiresAt: story.expiresAt };
  const message = { id: String(created._id), senderId: String(created.sender), recipientId: String(created.recipient), body: created.body, mediaType: "text", readAt: null, createdAt: created.createdAt, storyReply: serializedReply };
  req.app.get("io")?.to(`user:${story.creator}`).emit("message:new", { message, participant: { id: String(req.user._id), displayName: req.user.name, username: req.user.username, avatarUrl: req.user.avatar || null, role: req.user.role, isVerified: Boolean(req.user.isVerified), lastSeenAt: req.user.lastSeenAt || null }, conversationStatus: conversation.status });
  return sendResponse(res, 201, "Story reply sent", { message });
});

export const deleteStory = asyncHandler(async (req, res) => {
  const story = await Story.findOne({ _id: req.params.id, creator: req.user._id });
  if (!story) throw new ApiError(404, "Story not found");
  await Promise.all([StoryEngagement.deleteMany({ story: story._id }), story.deleteOne()]);
  await deleteAsset(story.image.assetId, story.image.resourceType || story.mediaType || "image").catch(() => {});
  return sendResponse(res, 200, "Story deleted");
});
