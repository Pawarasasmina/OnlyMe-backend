import mongoose from "mongoose";
import Story from "../models/Story.js";
import StoryEngagement from "../models/StoryEngagement.js";
import ProfileRelationship from "../models/ProfileRelationship.js";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import UserBlock from "../models/UserBlock.js";
import { storeFile, deleteAsset } from "../services/storageService.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { parseStoryEditorMetadata, parseStoryOptions } from "../services/storyMetadataService.js";

const activeStory = async (id) => { if (!mongoose.isValidObjectId(id)) throw new ApiError(400, "Invalid story ID"); const story = await Story.findOne({ _id: id, expiresAt: { $gt: new Date() } }); if (!story) throw new ApiError(404, "Story has expired or is unavailable"); return story; };
const followedStory = async (id, fanId) => { const story = await activeStory(id); const blocked = await UserBlock.exists({ $or: [{ blocker: fanId, blocked: story.creator }, { blocker: story.creator, blocked: fanId }] }); if (blocked || story.audience === "only_me") throw new ApiError(403, "This story is unavailable"); if (story.audience === "everyone" || !story.audience) return story; const follows = await ProfileRelationship.exists({ actor: fanId, target: story.creator, type: "FOLLOW" }); if (!follows) throw new ApiError(403, "Follow this creator to view their story"); if (story.audience === "close_circle") { const followsBack = await ProfileRelationship.exists({ actor: story.creator, target: fanId, type: "FOLLOW" }); if (!followsBack) throw new ApiError(403, "This story is available to the creator's close circle"); } return story; };
export const getStory = asyncHandler(async (req, res) => { const story = await activeStory(req.params.id); if (req.user.role === "creator" && String(story.creator) !== String(req.user._id)) throw new ApiError(403, "This story is unavailable"); if (req.user.role === "fan") await followedStory(req.params.id, req.user._id); await story.populate("creator", "name username avatar isVerified"); return sendResponse(res, 200, "Story fetched", { story: serialize(story, req.user._id) }); });
export const getStoryInsights = asyncHandler(async (req, res) => { const story = await activeStory(req.params.id); if (String(story.creator) !== String(req.user._id)) throw new ApiError(403, "Only the story creator can view insights"); const [engagements, replies] = await Promise.all([StoryEngagement.find({ story: story._id, viewedAt: { $ne: null } }).populate("fan", "name username avatar isVerified").lean(), Message.countDocuments({ "storyReply.story": story._id })]); const viewers = engagements.filter((item) => item.fan).map((item) => ({ id: item.fan._id, name: item.fan.name, username: item.fan.username, avatar: item.fan.avatar || "", verified: Boolean(item.fan.isVerified), viewedAt: item.viewedAt, reaction: item.reaction || null, reactedAt: item.reaction ? item.updatedAt : null })).sort((left, right) => Number(Boolean(right.reaction)) - Number(Boolean(left.reaction)) || new Date(right.reactedAt || right.viewedAt) - new Date(left.reactedAt || left.viewedAt)); const reactionMap = new Map(); for (const viewer of viewers) if (viewer.reaction) reactionMap.set(viewer.reaction, (reactionMap.get(viewer.reaction) || 0) + 1); return sendResponse(res, 200, "Story insights fetched", { storyId: story._id, totalViews: viewers.length, uniqueViewers: viewers.length, reactionTotal: viewers.filter((viewer) => viewer.reaction).length, reactions: [...reactionMap].map(([reaction, count]) => ({ reaction, count })).sort((left, right) => right.count - left.count), replies, shares: 0, viewers }); });
const serialize = (story, viewer, engagement, insights = null) => { const creatorId = story.creator?._id || story.creator; return { id: story._id, creatorId, owner: { id: creatorId, name: story.creator?.name || "Creator", username: story.creator?.username, avatar: story.creator?.avatar || story.image.url, verified: Boolean(story.creator?.isVerified), role: "creator" }, name: story.creator?.name || "Creator", username: story.creator?.username, avatar: story.creator?.avatar || story.image.url, verified: Boolean(story.creator?.isVerified), image: story.image.url, mediaType: "image", caption: story.caption, editorMetadata: story.editorMetadata || {}, audience: story.audience || "everyone", allowReactions: story.allowReactions !== false, allowReplies: story.allowReplies !== false, allowSharing: story.allowSharing !== false, createdAt: story.createdAt, expiresAt: story.expiresAt, isOwn: Boolean(viewer && String(creatorId) === String(viewer)), viewed: Boolean(engagement?.viewedAt), viewerReaction: engagement?.reaction || null, ...(insights ? { insights } : {}) }; };
export const createStory = asyncHandler(async (req, res) => { if (!req.file) throw new ApiError(400, "Story image is required"); const caption = String(req.body.caption || "").trim(); if (caption.length > 300) throw new ApiError(400, "Story caption may contain at most 300 characters"); const editorMetadata = parseStoryEditorMetadata(req.body.editorMetadata); const options = parseStoryOptions(req.body); const stored = await storeFile(req.file); const story = await Story.create({ creator: req.user._id, caption, image: { assetId: stored.id, url: stored.url }, editorMetadata, ...options, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }); await story.populate("creator", "name username avatar isVerified"); return sendResponse(res, 201, "Story is live for 24 hours", { story: serialize(story, req.user._id) }); });
export const listStories = asyncHandler(async (req, res) => {
  let creatorFilter = { creator: req.user._id };
  if (req.user.role === "fan") {
    const [follows, followsBack, blocks] = await Promise.all([
      ProfileRelationship.find({ actor: req.user._id, type: "FOLLOW" }).select("target").lean(),
      ProfileRelationship.find({ target: req.user._id, type: "FOLLOW" }).select("actor").lean(),
      UserBlock.find({ $or: [{ blocker: req.user._id }, { blocked: req.user._id }] }).select("blocker blocked").lean(),
    ]);
    const blockedIds = new Set(blocks.flatMap((item) => [String(item.blocker), String(item.blocked)]));
    const followedIds = follows.map((item) => item.target).filter((id) => !blockedIds.has(String(id)));
    const followsBackIds = new Set(followsBack.map((item) => String(item.actor)));
    const closeCircleIds = followedIds.filter((id) => followsBackIds.has(String(id)));
    creatorFilter = { creator: { $nin: [...blockedIds] }, $or: [{ audience: "everyone" }, { audience: { $exists: false } }, { audience: "followers", creator: { $in: followedIds } }, { audience: "close_circle", creator: { $in: closeCircleIds } }] };
  }
  const stories = await Story.find({ expiresAt: { $gt: new Date() }, ...creatorFilter }).sort({ createdAt: 1 }).populate("creator", "name username avatar isVerified").lean();
  const storyIds = stories.map((item) => item._id);
  const engagements = req.user.role === "fan" ? await StoryEngagement.find({ fan: req.user._id, story: { $in: storyIds } }).lean() : [];
  const byStory = new Map(engagements.map((item) => [String(item.story), item]));
  const creatorEngagements = req.user.role === "creator" ? await StoryEngagement.find({ story: { $in: storyIds } }).populate("fan", "name username avatar").sort({ updatedAt: -1 }).lean() : [];
  const insightsByStory = new Map();
  for (const item of creatorEngagements) {
    const key = String(item.story);
    const insights = insightsByStory.get(key) || { viewCount: 0, reactions: [], viewers: [] };
    if (item.viewedAt) { insights.viewCount += 1; if (item.fan) insights.viewers.push({ id: item.fan._id, name: item.fan.name, username: item.fan.username, avatar: item.fan.avatar || "", reaction: item.reaction || null, viewedAt: item.viewedAt, reactedAt: item.reaction ? item.updatedAt : null }); }
    if (item.reaction && item.fan) insights.reactions.push({ fan: { id: item.fan._id, name: item.fan.name, username: item.fan.username, avatar: item.fan.avatar || "" }, reaction: item.reaction, reactedAt: item.updatedAt });
    insightsByStory.set(key, insights);
  }
  for (const insights of insightsByStory.values()) insights.viewers.sort((left, right) => Number(Boolean(right.reaction)) - Number(Boolean(left.reaction)) || new Date(right.reactedAt || right.viewedAt) - new Date(left.reactedAt || left.viewedAt));
  return sendResponse(res, 200, "Active stories fetched", stories.map((item) => serialize(item, req.user._id, byStory.get(String(item._id)), insightsByStory.get(String(item._id)))));
});
export const viewStory = asyncHandler(async (req, res) => { await followedStory(req.params.id, req.user._id); await StoryEngagement.findOneAndUpdate({ story: req.params.id, fan: req.user._id }, { $set: { viewedAt: new Date() } }, { upsert: true, new: true }); return sendResponse(res, 200, "Story viewed", { storyId: req.params.id, viewed: true }); });
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
export const replyStory = asyncHandler(async (req, res) => { const story = await followedStory(req.params.id, req.user._id); if (story.allowReplies === false) throw new ApiError(403, "Replies are disabled for this story"); const body = String(req.body.body || "").trim(); if (!body) throw new ApiError(400, "Reply text is required"); if (body.length > 1000) throw new ApiError(400, "Story reply must be 1,000 characters or fewer"); const conversation = await Conversation.findOneAndUpdate({ fan: req.user._id, creator: story.creator }, { $set: { status: "ACTIVE", declinedAt: null }, $setOnInsert: { fan: req.user._id, creator: story.creator, acceptedAt: new Date(), acceptedByCreator: false } }, { new: true, upsert: true }); const storyReply = { story: story._id, imageUrl: story.image.url, caption: story.caption, expiresAt: story.expiresAt }; const created = await Message.create({ sender: req.user._id, recipient: story.creator, body, mediaType: "text", ppm: false, storyReply }); const serializedReply = { storyId: String(story._id), imageUrl: story.image.url, caption: story.caption, expiresAt: story.expiresAt }; const message = { id: String(created._id), senderId: String(created.sender), recipientId: String(created.recipient), body, mediaType: "text", readAt: null, createdAt: created.createdAt, storyReply: serializedReply }; req.app.get("io")?.to(`user:${story.creator}`).emit("message:new", { message, participant: { id: String(req.user._id), displayName: req.user.name, username: req.user.username, avatarUrl: req.user.avatar || null, role: req.user.role, isVerified: Boolean(req.user.isVerified), lastSeenAt: req.user.lastSeenAt || null }, conversationStatus: conversation.status }); return sendResponse(res, 201, "Story reply sent", { message }); });
export const deleteStory = asyncHandler(async (req, res) => { const story = await Story.findOne({ _id: req.params.id, creator: req.user._id }); if (!story) throw new ApiError(404, "Story not found"); await Promise.all([StoryEngagement.deleteMany({ story: story._id }), story.deleteOne()]); await deleteAsset(story.image.assetId).catch(() => {}); return sendResponse(res, 200, "Story deleted"); });
