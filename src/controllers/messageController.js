import mongoose from "mongoose";
import CreatorProfile from "../models/CreatorProfile.js";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import DAWindow from "../models/DAWindow.js";
import FeedPost from "../models/FeedPost.js";
import MessageReport from "../models/MessageReport.js";
import ProfileRelationship from "../models/ProfileRelationship.js";
import Publication from "../models/Publication.js";
import Story from "../models/Story.js";
import User from "../models/User.js";
import UserBlock from "../models/UserBlock.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { messageVoiceUrl, uploadMessageVoice } from "../services/messageVoiceStorageService.js";
import { messageVideoUrl, uploadMessageVideo } from "../services/messageVideoStorageService.js";
import { messageImageUrl, uploadMessageImage } from "../services/messageImageStorageService.js";
import { assertMessagingAccess } from "../services/messagingAccessService.js";
import { createDirectAccessMessageAtomic, releaseDirectAccessMessageReservation, reserveDirectAccessMessage, serializeDAWindow, settleDirectAccessReply } from "../services/directAccessService.js";
import { serializePublication } from "../services/publicationAccessService.js";

const userFields = "name username avatar role isVerified status lastSeenAt";
const person = (user, reason = "") => user && ({ id: user._id.toString(), displayName: user.name, name: user.name, username: user.username, avatarUrl: user.avatar || null, role: user.role, isVerified: Boolean(user.isVerified), lastSeenAt: user.lastSeenAt || null, reason });
const REACTION_EMOJIS = ["❤️", "😂", "😮", "😢", "😡", "👍"];
const serializedReply = (reply) => reply ? {
  id: String(reply._id || reply),
  senderId: reply.sender ? String(reply.sender?._id || reply.sender) : null,
  body: reply.deletedAt ? "Message unavailable" : reply.body || "Original message",
} : null;
const serializedSharedContent = (sharedContent, deletedAt = null) => {
  if (deletedAt || !sharedContent?.contentType) return null;
  return {
    contentType: sharedContent.contentType,
    contentId: sharedContent.contentId ? String(sharedContent.contentId) : null,
    route: sharedContent.route || "",
    title: sharedContent.title || "",
    previewText: sharedContent.previewText || "",
    imageUrl: sharedContent.imageUrl || "",
    author: sharedContent.author?.id ? {
      id: String(sharedContent.author.id),
      name: sharedContent.author.name || "",
      username: sharedContent.author.username || "",
      avatarUrl: sharedContent.author.avatarUrl || "",
    } : null,
  };
};
const serializedMessage = (message) => ({ id: message._id.toString(), clientMessageId: message.clientMessageId || null, senderId: (message.sender?._id || message.sender).toString(), recipientId: (message.recipient?._id || message.recipient).toString(), body: message.deletedAt ? "This message was deleted" : message.body, mediaType: message.mediaType || "text", messageKind: message.messageKind || "USER_MESSAGE", messageChannel: message.messageChannel || "STANDARD", directAccessWindowId: message.directAccessWindow ? String(message.directAccessWindow) : null, deletedAt: message.deletedAt || null, image: !message.deletedAt && message.mediaType === "image" && message.image?.assetId ? { url: messageImageUrl(message.image), width: message.image.width, height: message.image.height } : null, audio: !message.deletedAt && message.mediaType === "audio" && message.audio?.assetId ? { url: messageVoiceUrl(message.audio), duration: message.audio.duration, waveform: message.audio.waveform || [] } : null, video: !message.deletedAt && message.mediaType === "video" && message.video?.assetId ? { url: messageVideoUrl(message.video), duration: message.video.duration, width: message.video.width, height: message.video.height } : null, readAt: message.readAt || null, createdAt: message.createdAt, replyTo: serializedReply(message.replyTo), reactions: message.deletedAt ? [] : (message.reactions || []).map((reaction) => ({ userId: String(reaction.user?._id || reaction.user), emoji: reaction.emoji })), storyReply: !message.deletedAt && message.storyReply?.story ? { storyId: String(message.storyReply.story), imageUrl: message.storyReply.imageUrl, caption: message.storyReply.caption, expiresAt: message.storyReply.expiresAt || null } : null, sharedContent: serializedSharedContent(message.sharedContent, message.deletedAt) });
const validId = (value) => {
  if (!mongoose.isValidObjectId(value)) throw new ApiError(400, "Invalid account id");
};
const emitDirectAccessUpdate = (req, window) => {
  const payload = serializeDAWindow(window);
  if (!payload) return;
  req.app.get("io")?.to(`user:${payload.fanId}`).to(`user:${payload.creatorId}`).emit("direct-access:updated", payload);
};

async function blockState(currentId, otherId) {
  const rows = await UserBlock.find({
    $or: [
      { blocker: currentId, blocked: otherId },
      { blocker: otherId, blocked: currentId },
    ],
  }).select("blocker").lean();
  return {
    blockedByMe: rows.some((row) => String(row.blocker) === String(currentId)),
    blockedMe: rows.some((row) => String(row.blocker) === String(otherId)),
  };
}

async function assertAllowedPair(current, otherId, { allowBlocked = false } = {}) {
  if (!mongoose.isValidObjectId(otherId)) throw new ApiError(400, "Invalid account id");
  if (current._id.equals(otherId)) throw new ApiError(400, "You cannot message yourself");
  const other = await User.findOne({ _id: otherId, status: "active" }).select(userFields);
  if (!other) throw new ApiError(404, "Account not found");
  const roles = new Set([current.role, other.role]);
  const isFanCreatorPair = roles.has("fan") && roles.has("creator");
  const isCreatorShareThread = current.role === "creator" && other.role === "creator";
  if (!isFanCreatorPair && !isCreatorShareThread) throw new ApiError(403, "Messages are currently available only between fans and creators");
  if (other.role === "creator") {
    const profile = await CreatorProfile.findOne({ user: other._id }).select("messagingEnabled").lean();
    if (profile?.messagingEnabled === false) throw new ApiError(403, "This creator is not accepting messages");
  }
  const blocks = await blockState(current._id, other._id);
  if (!allowBlocked && (blocks.blockedByMe || blocks.blockedMe)) {
    throw new ApiError(403, blocks.blockedByMe ? "Unblock this account before messaging" : "Messaging is unavailable");
  }
  return other;
}

async function assertAllowedShareRecipient(current, otherId) {
  if (!mongoose.isValidObjectId(otherId)) throw new ApiError(400, "Invalid account id");
  if (current._id.equals(otherId)) throw new ApiError(400, "You cannot message yourself");
  const other = await User.findOne({ _id: otherId, status: "active" }).select(`${userFields} creatorApprovalStatus`);
  if (!other || other.role === "admin") throw new ApiError(404, "Account not found");
  if (current.role === "fan" && other.role !== "creator") throw new ApiError(403, "Fans can share posts with creators");
  if (current.role === "creator" && !["fan", "creator"].includes(other.role)) throw new ApiError(403, "This account cannot receive shares");
  if (other.role === "creator") {
    if (other.creatorApprovalStatus !== "approved") throw new ApiError(403, "This creator cannot receive shares yet");
    const profile = await CreatorProfile.findOne({ user: other._id }).select("messagingEnabled").lean();
    if (profile?.messagingEnabled === false) throw new ApiError(403, "This creator is not accepting messages");
  }
  const blocks = await blockState(current._id, other._id);
  if (blocks.blockedByMe || blocks.blockedMe) {
    throw new ApiError(403, blocks.blockedByMe ? "Unblock this account before sharing" : "Sharing is unavailable");
  }
  return other;
}

const pairFor = (current, other) => current.role === "fan"
  ? { fan: current._id, creator: other._id }
  : { fan: other._id, creator: current._id };

async function conversationFor(current, other) {
  if (current.role === "creator" && other.role === "creator") return null;
  const pair = pairFor(current, other);
  let conversation = await Conversation.findOne(pair);
  if (!conversation) {
    const hasMessages = await Message.exists({ $or: [{ sender: pair.fan, recipient: pair.creator }, { sender: pair.creator, recipient: pair.fan }] });
    if (hasMessages) conversation = await Conversation.findOneAndUpdate(pair, { $setOnInsert: { ...pair, status: "ACTIVE", acceptedAt: new Date(), acceptedByCreator: false } }, { new: true, upsert: true });
  }
  return conversation;
}

function cleanShareText(value, maxLength = 2000) {
  const clean = String(value || "").trim().replace(/\r\n/g, "\n");
  return clean.length > maxLength ? clean.slice(0, maxLength) : clean;
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compactPreview(value = "", maxLength = 160) {
  const clean = String(value || "").trim().replace(/\s+/g, " ");
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1).trim()}...` : clean;
}

function contentLabel(contentType = "") {
  if (contentType === "feed_post") return "post";
  if (contentType === "seen") return "Seen";
  if (contentType === "world") return "World";
  if (contentType === "experience") return "experience";
  if (contentType === "profile") return "profile";
  if (contentType === "story") return "story";
  return "content";
}

function normalizeShareContentInput(sharedContent = {}) {
  const contentType = String(sharedContent.contentType || "").trim();
  const contentId = String(sharedContent.contentId || "").trim();
  const allowed = new Set(["feed_post", "seen", "world", "experience", "profile", "story"]);
  if (!allowed.has(contentType)) throw new ApiError(400, "Unsupported shared content type");
  if (!mongoose.isValidObjectId(contentId)) throw new ApiError(400, "Invalid shared content id");
  return { contentType, contentId };
}

async function blockedIdsFor(userId) {
  const blocks = await UserBlock.find({
    $or: [{ blocker: userId }, { blocked: userId }],
  }).select("blocker blocked").lean();
  return new Set(blocks.flatMap((item) => [String(item.blocker), String(item.blocked)]));
}

function shareRecipientMatch({ current, blockedIds = new Set(), ids = [], q = "" } = {}) {
  const clauses = [
    { status: "active" },
    { role: current.role === "fan" ? "creator" : { $in: ["fan", "creator"] } },
  ];
  if (current.role === "fan") {
    clauses.push({ creatorApprovalStatus: "approved" });
  } else {
    clauses.push({ $or: [{ role: "fan" }, { role: "creator", creatorApprovalStatus: "approved" }] });
  }
  const excludedIds = [...blockedIds].filter(Boolean);
  if (excludedIds.length) clauses.push({ _id: { $nin: excludedIds } });
  if (ids.length) clauses.push({ _id: { $in: ids } });
  if (q) {
    const escaped = escapeRegex(q);
    clauses.push({
      $or: [
        { name: { $regex: escaped, $options: "i" } },
        { username: { $regex: escaped, $options: "i" } },
      ],
    });
  }
  return { $and: clauses };
}

async function sharedContentSnapshot(input, viewer) {
  const { contentType, contentId } = normalizeShareContentInput(input);
  if (contentType === "feed_post") {
    const post = await FeedPost.findOne({ _id: contentId, status: "published", visibility: "public", deletedAt: null })
      .populate("author", "name username avatar isVerified role status")
      .lean();
    if (!post || post.author?.status !== "active") throw new ApiError(404, "This content is no longer available");
    const blocked = await UserBlock.exists({ $or: [{ blocker: viewer._id, blocked: post.author._id }, { blocker: post.author._id, blocked: viewer._id }] });
    if (blocked) throw new ApiError(403, "This content cannot be shared");
    return {
      contentType,
      contentId: post._id,
      route: `/posts/${post._id}`,
      title: post.context ? `${post.context}${post.location ? ` - ${post.location}` : ""}` : "Home post",
      previewText: compactPreview(post.text || "Shared a Home post"),
      imageUrl: post.media?.[0]?.url || "",
      author: { id: post.author._id, name: post.author.name, username: post.author.username, avatarUrl: post.author.avatar || "" },
    };
  }
  if (["seen", "world", "experience"].includes(contentType)) {
    const kind = contentType === "seen" ? "SEEN" : "WORLD";
    const publication = await Publication.findOne({ _id: contentId, kind, status: "PUBLISHED" })
      .populate("creator", "name username avatar role status")
      .lean();
    const serialized = publication ? serializePublication(publication, viewer) : null;
    if (!publication || !serialized || publication.creator?.status !== "active") throw new ApiError(404, "This content is no longer available");
    const blocked = await UserBlock.exists({ $or: [{ blocker: viewer._id, blocked: publication.creator._id }, { blocker: publication.creator._id, blocked: viewer._id }] });
    if (blocked) throw new ApiError(403, "This content cannot be shared");
    return {
      contentType,
      contentId: publication._id,
      route: `/${contentType === "seen" ? "seen" : "world"}/${publication._id}`,
      title: compactPreview(serialized.title || contentLabel(contentType), 120),
      previewText: compactPreview(serialized.summary || serialized.description || serialized.title || ""),
      imageUrl: serialized.coverMedia?.secureUrl || "",
      author: { id: publication.creator._id, name: publication.creator.name, username: publication.creator.username, avatarUrl: publication.creator.avatar || "" },
    };
  }
  if (contentType === "profile") {
    const owner = await User.findOne({ _id: contentId, status: "active" }).select(userFields).lean();
    if (!owner || owner.role === "admin") throw new ApiError(404, "Profile not found");
    const blocked = await UserBlock.exists({ $or: [{ blocker: viewer._id, blocked: owner._id }, { blocker: owner._id, blocked: viewer._id }] });
    if (blocked) throw new ApiError(403, "This profile cannot be shared");
    return {
      contentType,
      contentId: owner._id,
      route: `/profile/${encodeURIComponent(owner.username)}`,
      title: owner.name,
      previewText: `@${owner.username} on @seen`,
      imageUrl: owner.avatar || "",
      author: { id: owner._id, name: owner.name, username: owner.username, avatarUrl: owner.avatar || "" },
    };
  }
  const story = await Story.findOne({ _id: contentId, expiresAt: { $gt: new Date() }, allowSharing: true })
    .populate("creator", "name username avatar role status")
    .lean();
  if (!story || story.creator?.status !== "active" || story.audience === "only_me") throw new ApiError(404, "Story not available to share");
  const blocked = await UserBlock.exists({ $or: [{ blocker: viewer._id, blocked: story.creator._id }, { blocker: story.creator._id, blocked: viewer._id }] });
  if (blocked) throw new ApiError(403, "This story cannot be shared");
  return {
    contentType,
    contentId: story._id,
    route: `/stories/${story._id}`,
    title: "Story",
    previewText: compactPreview(story.caption || "Shared a story"),
    imageUrl: story.image?.url || "",
    author: { id: story.creator._id, name: story.creator.name, username: story.creator.username, avatarUrl: story.creator.avatar || "" },
  };
}

async function readyStandardConversation(current, other) {
  let conversation = await conversationFor(current, other);
  if (current.role === "fan" && conversation?.status === "ACTIVE" && conversation.acceptedByCreator !== true) {
    const follows = await ProfileRelationship.exists({ actor: current._id, target: other._id, type: "FOLLOW" });
    if (!follows) conversation = await Conversation.findByIdAndUpdate(conversation._id, { $set: { status: "REQUEST", requestStartedAt: new Date(), acceptedAt: null } }, { new: true });
  }
  if (!conversation) {
    if (current.role !== "fan") throw new ApiError(403, "Creators can share into accepted fan conversations only");
    const follows = await ProfileRelationship.exists({ actor: current._id, target: other._id, type: "FOLLOW" });
    conversation = await Conversation.create({ ...pairFor(current, other), status: follows ? "ACTIVE" : "REQUEST", acceptedAt: follows ? new Date() : null, acceptedByCreator: false, requestStartedAt: follows ? null : new Date() });
  }
  if (conversation.status === "REQUEST" && current.role === "creator") throw new ApiError(403, "Accept this message request before sharing");
  if (conversation.status === "DECLINED") throw new ApiError(403, "This message request was declined");
  if (conversation.status === "REQUEST" && current.role === "fan") {
    const alreadySent = await Message.exists({ sender: current._id, recipient: other._id, createdAt: { $gte: conversation.requestStartedAt || conversation.createdAt } });
    if (alreadySent) throw new ApiError(409, "Wait for the creator to accept your message request");
  }
  return conversation;
}

async function readyShareConversation(current, other) {
  if (current.role === "creator" && other.role === "creator") return null;
  return readyStandardConversation(current, other);
}

export const listConversations = asyncHandler(async (req, res) => {
  const me = req.user._id;
  const grouped = await Message.aggregate([
    { $match: { $or: [{ sender: me }, { recipient: me }], messageChannel: { $in: ["STANDARD", null] }, directAccessWindow: null, deletedAt: null, deletedFor: { $ne: me } } },
    { $sort: { createdAt: -1, _id: -1 } },
    {
      $group: {
        _id: { $cond: [{ $eq: ["$sender", me] }, "$recipient", "$sender"] },
        lastMessage: { $first: "$$ROOT" },
        unreadCount: {
          $sum: {
            $cond: [
              { $and: [{ $eq: ["$recipient", me] }, { $eq: ["$readAt", null] }] },
              1,
              0,
            ],
          },
        },
      },
    },
    { $sort: { "lastMessage.createdAt": -1, "lastMessage._id": -1 } },
  ]);
  const users = await User.find({ _id: { $in: grouped.map((item) => item._id) }, status: "active" }).select(userFields).lean();
  const userById = new Map(users.map((item) => [String(item._id), item]));
  const conversationStates = await Conversation.find(req.user.role === "creator" ? { creator: me } : { fan: me }).lean();
  const stateByOther = new Map(conversationStates.map((item) => [String(req.user.role === "creator" ? item.fan : item.creator), item.status]));
  const conversations = grouped.flatMap((item) => {
    const participant = userById.get(String(item._id));
    if (!participant) return [];
    return [{
      id: String(item._id),
      participant: person(participant),
      lastMessage: serializedMessage(item.lastMessage),
      unreadCount: item.unreadCount,
      status: stateByOther.get(String(item._id)) || "ACTIVE",
    }];
  });
  return sendResponse(res, 200, "Conversations fetched", { conversations });
});

export const listMessages = asyncHandler(async (req, res) => {
  const other = await assertAllowedPair(req.user, req.params.userId, { allowBlocked: true });
  const blocks = await blockState(req.user._id, other._id);
  const conversation = await conversationFor(req.user, other);
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const cursor = req.query.cursor ? String(req.query.cursor) : null;
  if (cursor && !mongoose.isValidObjectId(cursor)) throw new ApiError(400, "Invalid message cursor");
  if (!(req.user.role === "creator" && conversation?.status === "REQUEST")) {
    const readAt = new Date();
    const result = await Message.updateMany(
      { sender: other._id, recipient: req.user._id, readAt: null },
      { $set: { readAt } },
    );
    if (result.modifiedCount > 0) {
      req.app.get("io")?.to(`user:${other._id}`).emit("messages:read", {
        byUserId: req.user._id.toString(),
        readAt,
      });
    }
  }
  const requestedWindowId = req.query.directAccessWindowId || null;
  let requestedWindow = null;
  let threadWindowIds = [];
  if (requestedWindowId) {
    validId(requestedWindowId);
    requestedWindow = await DAWindow.findOne({
      _id: requestedWindowId,
      $or: [
        { fan: req.user._id, creator: other._id },
        { fan: other._id, creator: req.user._id },
      ],
    });
    if (!requestedWindow) throw new ApiError(404, "Direct Access thread not found");
    const threadRootId = requestedWindow.threadRootWindow || requestedWindow._id;
    const threadWindows = await DAWindow.find({
      fan: requestedWindow.fan,
      creator: requestedWindow.creator,
      $or: [
        { _id: threadRootId },
        { threadRootWindow: threadRootId },
        { reopenedFromWindow: threadRootId },
      ],
    }).sort({ createdAt: -1 });
    threadWindowIds = threadWindows.map((window) => window._id);
    const missingRoots = threadWindows.filter((window) => !window.threadRootWindow).map((window) => window._id);
    if (missingRoots.length) {
      await DAWindow.updateMany({ _id: { $in: missingRoots } }, { $set: { threadRootWindow: threadRootId } });
    }
    requestedWindow = threadWindows.find((window) => Boolean(window.activeWindowKey))
      || threadWindows.find((window) => String(window._id) === String(requestedWindowId))
      || requestedWindow;
    if (
      ["OPEN", "ANSWERED"].includes(requestedWindow.status)
      && requestedWindow.fanMessagesUsed >= requestedWindow.fanMessageLimit
    ) {
      requestedWindow.status = "CLOSED";
      requestedWindow.closedAt ||= new Date();
      requestedWindow.activeWindowKey = undefined;
      requestedWindow.version += 1;
      await requestedWindow.save();
    }
  }
  const messageFilter = {
    $or: [{ sender: req.user._id, recipient: other._id }, { sender: other._id, recipient: req.user._id }],
    deletedFor: { $ne: req.user._id },
    ...(requestedWindow
      ? {
        $and: [{
          $or: [
            { messageChannel: "DIRECT_ACCESS", directAccessWindow: { $in: threadWindowIds } },
            { messageKind: "CREATOR_ASK", directAccessWindow: { $in: threadWindowIds } },
          ],
        }],
      }
      : { messageChannel: { $in: ["STANDARD", null] }, directAccessWindow: null }),
    ...(cursor ? { _id: { $lt: cursor } } : {}),
  };
  const rows = await Message.find(messageFilter).sort({ _id: -1 }).limit(limit + 1).populate("replyTo", "sender body deletedAt").lean();
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const followsCreator = req.user.role === "fan"
    ? Boolean(await ProfileRelationship.exists({ actor: req.user._id, target: other._id, type: "FOLLOW" }))
    : null;
  return sendResponse(res, 200, "Messages fetched", {
    participant: person(other),
    messages: page.reverse().map(serializedMessage),
    pageInfo: {
      hasMore,
      nextCursor: hasMore ? String(page[page.length - 1]._id) : null,
    },
    conversationStatus: conversation?.status || null,
    requestRequired: req.user.role === "fan" && !followsCreator && (!conversation || (conversation.status === "ACTIVE" && conversation.acceptedByCreator !== true)),
    blockStatus: blocks,
    directAccessWindow: serializeDAWindow(requestedWindow),
    threadType: requestedWindow ? "DIRECT_ACCESS" : "STANDARD",
  });
});

export const sendMessage = asyncHandler(async (req, res) => {
  assertMessagingAccess(req.user);
  const other = await assertAllowedPair(req.user, req.params.userId);
  const body = String(req.body.body || "").trim();
  if (!body) throw new ApiError(400, "Message text is required");
  if (body.length > 2000) throw new ApiError(400, "Message must be 2000 characters or fewer");
  const clientMessageId = String(req.body.clientMessageId || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(clientMessageId)) {
    throw new ApiError(400, "A valid client message id is required");
  }
  let conversation = await conversationFor(req.user, other);
  const isCreatorPeerThread = req.user.role === "creator" && other.role === "creator";
  const existingMessage = await Message.findOne({ sender: req.user._id, clientMessageId }).populate("replyTo", "sender body deletedAt");
  if (existingMessage) {
    if (!existingMessage.recipient.equals(other._id) || existingMessage.body !== body) {
      throw new ApiError(409, "Client message id was already used for another message");
    }
    return sendResponse(res, 200, "Message already sent", {
      message: serializedMessage(existingMessage),
      conversationStatus: conversation?.status || "ACTIVE",
      idempotentReplay: true,
    });
  }
  if (req.user.role === "fan" && conversation?.status === "ACTIVE" && conversation.acceptedByCreator !== true) {
    const follows = await ProfileRelationship.exists({ actor: req.user._id, target: other._id, type: "FOLLOW" });
    if (!follows) conversation = await Conversation.findByIdAndUpdate(conversation._id, { $set: { status: "REQUEST", requestStartedAt: new Date(), acceptedAt: null } }, { new: true });
  }
  if (!conversation && !isCreatorPeerThread) {
    if (req.user.role !== "fan") throw new ApiError(403, "Creators can reply after accepting a fan request");
    const follows = await ProfileRelationship.exists({ actor: req.user._id, target: other._id, type: "FOLLOW" });
    conversation = await Conversation.create({ ...pairFor(req.user, other), status: follows ? "ACTIVE" : "REQUEST", acceptedAt: follows ? new Date() : null, acceptedByCreator: false, requestStartedAt: follows ? null : new Date() });
  }
  if (conversation?.status === "REQUEST" && req.user.role === "creator") throw new ApiError(403, "Accept this message request before replying");
  if (conversation?.status === "DECLINED") throw new ApiError(403, "This message request was declined");
  if (conversation?.status === "REQUEST" && req.user.role === "fan") {
    const alreadySent = await Message.exists({ sender: req.user._id, recipient: other._id, createdAt: { $gte: conversation.requestStartedAt || conversation.createdAt } });
    if (alreadySent) throw new ApiError(409, "Wait for the creator to accept your message request");
  }
  let replyTo = null;
  if (req.body.replyToId) {
    validId(req.body.replyToId);
    replyTo = await Message.findOne({
      _id: req.body.replyToId,
      deletedAt: null,
      $or: [
        { sender: req.user._id, recipient: other._id },
        { sender: other._id, recipient: req.user._id },
      ],
    }).select("sender body deletedAt");
    if (!replyTo) throw new ApiError(404, "The message you are replying to is unavailable");
  }
  let created;
  let createdNow = true;
  if (req.body.directAccessWindowId) {
    const committed = await createDirectAccessMessageAtomic({
      windowId: req.body.directAccessWindowId,
      sender: req.user,
      recipient: other,
      message: { clientMessageId, body, mediaType: "text", ppm: false, replyTo: replyTo?._id || null },
    });
    created = committed.message;
    createdNow = !committed.replay;
    const directAccessWindow = committed.window;
    emitDirectAccessUpdate(req, directAccessWindow);
    if (replyTo && created.populate) await created.populate("replyTo", "sender body deletedAt");
    const payload = serializedMessage(created);
    const conversationStatus = conversation?.status || "ACTIVE";
    if (createdNow) req.app.get("io")?.to(`user:${other._id}`).emit("message:new", { message: payload, participant: person(req.user), conversationStatus });
    return sendResponse(res, createdNow ? 201 : 200, createdNow ? "Direct Access message sent" : "Message already sent", { message: payload, conversationStatus, directAccessWindow: serializeDAWindow(directAccessWindow), idempotentReplay: !createdNow });
  }
  const directAccess = await reserveDirectAccessMessage({
    windowId: req.body.directAccessWindowId,
    sender: req.user,
    recipient: other,
  });
  try {
    created = await Message.create({ sender: req.user._id, recipient: other._id, clientMessageId, body, mediaType: "text", ppm: false, replyTo: replyTo?._id || null, messageChannel: directAccess ? "DIRECT_ACCESS" : "STANDARD", directAccessWindow: directAccess?.window._id || null });
  } catch (error) {
    if (error?.code !== 11000) {
      await releaseDirectAccessMessageReservation(directAccess);
      throw error;
    }
    created = await Message.findOne({ sender: req.user._id, clientMessageId });
    if (!created) {
      await releaseDirectAccessMessageReservation(directAccess);
      throw error;
    }
    await releaseDirectAccessMessageReservation(directAccess);
    createdNow = false;
  }
  let directAccessWindow = directAccess?.window || null;
  if (createdNow) directAccessWindow = await settleDirectAccessReply(directAccess, req.user);
  emitDirectAccessUpdate(req, directAccessWindow);
  if (replyTo) await created.populate("replyTo", "sender body deletedAt");
  const payload = serializedMessage(created);
  const conversationStatus = conversation?.status || "ACTIVE";
  if (createdNow) {
    req.app.get("io")?.to(`user:${other._id}`).emit("message:new", { message: payload, participant: person(req.user), conversationStatus });
  }
  return sendResponse(res, createdNow ? 201 : 200, createdNow ? conversationStatus === "REQUEST" ? "Message request sent" : "Message sent" : "Message already sent", { message: payload, conversationStatus, directAccessWindow: serializeDAWindow(directAccessWindow), idempotentReplay: !createdNow });
});

export const sendVoiceMessage = asyncHandler(async (req, res) => {
  assertMessagingAccess(req.user);
  const other = await assertAllowedPair(req.user, req.params.userId);
  if (!req.file?.buffer) throw new ApiError(400, "A voice recording is required");
  const clientMessageId = String(req.body.clientMessageId || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(clientMessageId)) throw new ApiError(400, "A valid client message id is required");
  const existing = await Message.findOne({ sender: req.user._id, clientMessageId });
  if (existing) return sendResponse(res, 200, "Voice message already sent", { message: serializedMessage(existing), idempotentReplay: true });
  let conversation = await conversationFor(req.user, other);
  if (req.user.role === "fan" && conversation?.status === "ACTIVE" && conversation.acceptedByCreator !== true) {
    const follows = await ProfileRelationship.exists({ actor: req.user._id, target: other._id, type: "FOLLOW" });
    if (!follows) conversation = await Conversation.findByIdAndUpdate(conversation._id, { $set: { status: "REQUEST", requestStartedAt: new Date(), acceptedAt: null } }, { new: true });
  }
  if (!conversation) {
    if (req.user.role !== "fan") throw new ApiError(403, "Creators can reply after accepting a fan request");
    const follows = await ProfileRelationship.exists({ actor: req.user._id, target: other._id, type: "FOLLOW" });
    conversation = await Conversation.create({ ...pairFor(req.user, other), status: follows ? "ACTIVE" : "REQUEST", acceptedAt: follows ? new Date() : null, acceptedByCreator: false, requestStartedAt: follows ? null : new Date() });
  }
  if (conversation.status === "REQUEST" && req.user.role === "creator") throw new ApiError(403, "Accept this message request before replying");
  if (conversation.status === "DECLINED") throw new ApiError(403, "This message request was declined");
  if (conversation.status === "REQUEST" && req.user.role === "fan") {
    const alreadySent = await Message.exists({ sender: req.user._id, recipient: other._id, createdAt: { $gte: conversation.requestStartedAt || conversation.createdAt } });
    if (alreadySent) throw new ApiError(409, "Wait for the creator to accept your message request");
  }
  let waveform = [];
  try { waveform = JSON.parse(req.body.waveform || "[]"); } catch { throw new ApiError(400, "Invalid voice waveform"); }
  waveform = Array.isArray(waveform) ? waveform.slice(0, 48).map((value) => Math.min(1, Math.max(0.08, Number(value) || 0.08))) : [];
  const audio = await uploadMessageVoice({ buffer: req.file.buffer, senderId: req.user._id });
  if (req.body.directAccessWindowId) {
    const committed = await createDirectAccessMessageAtomic({ windowId: req.body.directAccessWindowId, sender: req.user, recipient: other, message: { clientMessageId, body: "Voice message", mediaType: "audio", ppm: false, audio: { ...audio, waveform } } });
    emitDirectAccessUpdate(req, committed.window);
    const payload = serializedMessage(committed.message);
    if (!committed.replay) req.app.get("io")?.to(`user:${other._id}`).emit("message:new", { message: payload, participant: person(req.user), conversationStatus: conversation.status });
    return sendResponse(res, committed.replay ? 200 : 201, committed.replay ? "Voice message already sent" : "Voice message sent", { message: payload, conversationStatus: conversation.status, directAccessWindow: serializeDAWindow(committed.window), idempotentReplay: committed.replay });
  }
  const directAccess = await reserveDirectAccessMessage({ windowId: req.body.directAccessWindowId, sender: req.user, recipient: other });
  let created;
  try {
    created = await Message.create({ sender: req.user._id, recipient: other._id, clientMessageId, body: "Voice message", mediaType: "audio", ppm: false, audio: { ...audio, waveform }, messageChannel: directAccess ? "DIRECT_ACCESS" : "STANDARD", directAccessWindow: directAccess?.window._id || null });
  } catch (error) {
    await releaseDirectAccessMessageReservation(directAccess);
    throw error;
  }
  const directAccessWindow = await settleDirectAccessReply(directAccess, req.user);
  emitDirectAccessUpdate(req, directAccessWindow);
  const payload = serializedMessage(created);
  req.app.get("io")?.to(`user:${other._id}`).emit("message:new", { message: payload, participant: person(req.user), conversationStatus: conversation.status });
  return sendResponse(res, 201, conversation.status === "REQUEST" ? "Voice-message request sent" : "Voice message sent", { message: payload, conversationStatus: conversation.status, directAccessWindow: serializeDAWindow(directAccessWindow) });
});

export const sendVideoNote = asyncHandler(async (req, res) => {
  assertMessagingAccess(req.user);
  const other = await assertAllowedPair(req.user, req.params.userId);
  if (!req.file?.buffer) throw new ApiError(400, "A video note is required");
  const clientMessageId = String(req.body.clientMessageId || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(clientMessageId)) throw new ApiError(400, "A valid client message id is required");
  const existing = await Message.findOne({ sender: req.user._id, clientMessageId });
  if (existing) return sendResponse(res, 200, "Video note already sent", { message: serializedMessage(existing), idempotentReplay: true });
  let conversation = await conversationFor(req.user, other);
  if (req.user.role === "fan" && conversation?.status === "ACTIVE" && conversation.acceptedByCreator !== true) {
    const follows = await ProfileRelationship.exists({ actor: req.user._id, target: other._id, type: "FOLLOW" });
    if (!follows) conversation = await Conversation.findByIdAndUpdate(conversation._id, { $set: { status: "REQUEST", requestStartedAt: new Date(), acceptedAt: null } }, { new: true });
  }
  if (!conversation) {
    if (req.user.role !== "fan") throw new ApiError(403, "Creators can reply after accepting a fan request");
    const follows = await ProfileRelationship.exists({ actor: req.user._id, target: other._id, type: "FOLLOW" });
    conversation = await Conversation.create({ ...pairFor(req.user, other), status: follows ? "ACTIVE" : "REQUEST", acceptedAt: follows ? new Date() : null, acceptedByCreator: false, requestStartedAt: follows ? null : new Date() });
  }
  if (conversation.status === "REQUEST" && req.user.role === "creator") throw new ApiError(403, "Accept this message request before replying");
  if (conversation.status === "DECLINED") throw new ApiError(403, "This message request was declined");
  if (conversation.status === "REQUEST" && req.user.role === "fan") {
    const alreadySent = await Message.exists({ sender: req.user._id, recipient: other._id, createdAt: { $gte: conversation.requestStartedAt || conversation.createdAt } });
    if (alreadySent) throw new ApiError(409, "Wait for the creator to accept your message request");
  }
  const video = await uploadMessageVideo({ buffer: req.file.buffer, senderId: req.user._id });
  if (req.body.directAccessWindowId) {
    const committed = await createDirectAccessMessageAtomic({ windowId: req.body.directAccessWindowId, sender: req.user, recipient: other, message: { clientMessageId, body: "Video note", mediaType: "video", ppm: false, video } });
    emitDirectAccessUpdate(req, committed.window);
    const payload = serializedMessage(committed.message);
    if (!committed.replay) req.app.get("io")?.to(`user:${other._id}`).emit("message:new", { message: payload, participant: person(req.user), conversationStatus: conversation.status });
    return sendResponse(res, committed.replay ? 200 : 201, committed.replay ? "Video note already sent" : "Video note sent", { message: payload, conversationStatus: conversation.status, directAccessWindow: serializeDAWindow(committed.window), idempotentReplay: committed.replay });
  }
  const directAccess = await reserveDirectAccessMessage({ windowId: req.body.directAccessWindowId, sender: req.user, recipient: other });
  let created;
  try {
    created = await Message.create({ sender: req.user._id, recipient: other._id, clientMessageId, body: "Video note", mediaType: "video", ppm: false, video, messageChannel: directAccess ? "DIRECT_ACCESS" : "STANDARD", directAccessWindow: directAccess?.window._id || null });
  } catch (error) {
    await releaseDirectAccessMessageReservation(directAccess);
    throw error;
  }
  const directAccessWindow = await settleDirectAccessReply(directAccess, req.user);
  emitDirectAccessUpdate(req, directAccessWindow);
  const payload = serializedMessage(created);
  req.app.get("io")?.to(`user:${other._id}`).emit("message:new", { message: payload, participant: person(req.user), conversationStatus: conversation.status });
  return sendResponse(res, 201, conversation.status === "REQUEST" ? "Video-note request sent" : "Video note sent", { message: payload, conversationStatus: conversation.status, directAccessWindow: serializeDAWindow(directAccessWindow) });
});

export const sendImageMessage = asyncHandler(async (req, res) => {
  assertMessagingAccess(req.user);
  const other = await assertAllowedPair(req.user, req.params.userId);
  if (!req.file?.buffer) throw new ApiError(400, "An image is required");
  const clientMessageId = String(req.body.clientMessageId || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(clientMessageId)) throw new ApiError(400, "A valid client message id is required");
  const caption = String(req.body.caption || "").trim();
  if (caption.length > 2000) throw new ApiError(400, "Image caption must be 2,000 characters or fewer");
  const existing = await Message.findOne({ sender: req.user._id, clientMessageId });
  if (existing) return sendResponse(res, 200, "Image already sent", { message: serializedMessage(existing), idempotentReplay: true });

  let conversation = await conversationFor(req.user, other);
  if (req.user.role === "fan" && conversation?.status === "ACTIVE" && conversation.acceptedByCreator !== true) {
    const follows = await ProfileRelationship.exists({ actor: req.user._id, target: other._id, type: "FOLLOW" });
    if (!follows) conversation = await Conversation.findByIdAndUpdate(conversation._id, { $set: { status: "REQUEST", requestStartedAt: new Date(), acceptedAt: null } }, { new: true });
  }
  if (!conversation) {
    if (req.user.role !== "fan") throw new ApiError(403, "Creators can reply after accepting a fan request");
    const follows = await ProfileRelationship.exists({ actor: req.user._id, target: other._id, type: "FOLLOW" });
    conversation = await Conversation.create({ ...pairFor(req.user, other), status: follows ? "ACTIVE" : "REQUEST", acceptedAt: follows ? new Date() : null, acceptedByCreator: false, requestStartedAt: follows ? null : new Date() });
  }
  if (conversation.status === "REQUEST" && req.user.role === "creator") throw new ApiError(403, "Accept this message request before replying");
  if (conversation.status === "DECLINED") throw new ApiError(403, "This message request was declined");
  if (conversation.status === "REQUEST" && req.user.role === "fan") {
    const alreadySent = await Message.exists({ sender: req.user._id, recipient: other._id, createdAt: { $gte: conversation.requestStartedAt || conversation.createdAt } });
    if (alreadySent) throw new ApiError(409, "Wait for the creator to accept your message request");
  }
  const image = await uploadMessageImage({ buffer: req.file.buffer, senderId: req.user._id });
  if (req.body.directAccessWindowId) {
    const committed = await createDirectAccessMessageAtomic({ windowId: req.body.directAccessWindowId, sender: req.user, recipient: other, message: { clientMessageId, body: caption || "Image", mediaType: "image", image } });
    emitDirectAccessUpdate(req, committed.window);
    const payload = serializedMessage(committed.message);
    if (!committed.replay) req.app.get("io")?.to(`user:${other._id}`).emit("message:new", { message: payload, participant: person(req.user), conversationStatus: conversation.status });
    return sendResponse(res, committed.replay ? 200 : 201, committed.replay ? "Image already sent" : "Image sent", { message: payload, conversationStatus: conversation.status, directAccessWindow: serializeDAWindow(committed.window), idempotentReplay: committed.replay });
  }
  const directAccess = await reserveDirectAccessMessage({ windowId: req.body.directAccessWindowId, sender: req.user, recipient: other });
  let created;
  try {
    created = await Message.create({ sender: req.user._id, recipient: other._id, clientMessageId, body: caption || "Image", mediaType: "image", image, messageChannel: directAccess ? "DIRECT_ACCESS" : "STANDARD", directAccessWindow: directAccess?.window._id || null });
  } catch (error) {
    await releaseDirectAccessMessageReservation(directAccess);
    throw error;
  }
  const directAccessWindow = await settleDirectAccessReply(directAccess, req.user);
  emitDirectAccessUpdate(req, directAccessWindow);
  const payload = serializedMessage(created);
  req.app.get("io")?.to(`user:${other._id}`).emit("message:new", { message: payload, participant: person(req.user), conversationStatus: conversation.status });
  return sendResponse(res, 201, conversation.status === "REQUEST" ? "Image-message request sent" : "Image sent", { message: payload, conversationStatus: conversation.status, directAccessWindow: serializeDAWindow(directAccessWindow) });
});

export const deleteMessage = asyncHandler(async (req, res) => {
  validId(req.params.messageId);
  const scope = String(req.query.scope || "me").toLowerCase();
  if (!["me", "everyone"].includes(scope)) throw new ApiError(400, "Invalid delete scope");
  const message = await Message.findOne({
    _id: req.params.messageId,
    $or: [{ sender: req.user._id }, { recipient: req.user._id }],
  });
  if (!message) throw new ApiError(404, "Message not found");
  if (scope === "me") {
    if (!message.deletedFor.some((userId) => userId.equals(req.user._id))) {
      message.deletedFor.push(req.user._id);
      await message.save();
    }
    const payload = { messageId: String(message._id), hiddenForUserId: String(req.user._id) };
    req.app.get("io")?.to(`user:${req.user._id}`).emit("message:hidden", payload);
    return sendResponse(res, 200, "Message deleted for you", payload);
  }
  if (!message.sender.equals(req.user._id) || message.deletedAt) {
    throw new ApiError(403, "Only the sender can unsend this message");
  }
  message.deletedAt = new Date();
  message.reactions = [];
  await message.save();
  const payload = { messageId: String(message._id), deletedAt: message.deletedAt, message: serializedMessage(message) };
  req.app.get("io")?.to(`user:${message.sender}`).to(`user:${message.recipient}`).emit("message:deleted", payload);
  return sendResponse(res, 200, "Message unsent", payload);
});

export const deleteConversation = asyncHandler(async (req, res) => {
  const other = await assertAllowedPair(req.user, req.params.userId, { allowBlocked: true });
  const result = await Message.updateMany(
    {
      $or: [
        { sender: req.user._id, recipient: other._id },
        { sender: other._id, recipient: req.user._id },
      ],
      deletedFor: { $ne: req.user._id },
    },
    { $addToSet: { deletedFor: req.user._id } },
  );
  const payload = {
    otherUserId: String(other._id),
    hiddenForUserId: String(req.user._id),
    hiddenMessageCount: result.modifiedCount,
  };
  req.app.get("io")?.to(`user:${req.user._id}`).emit("conversation:hidden", payload);
  return sendResponse(res, 200, "Conversation deleted for you", payload);
});

const REPORT_REASONS = new Set(["SPAM", "HARASSMENT", "HATE", "SEXUAL_CONTENT", "VIOLENCE", "SCAM", "OTHER"]);
function reportInput(req) {
  const reason = String(req.body.reason || "").trim().toUpperCase();
  const details = String(req.body.details || "").trim();
  if (!REPORT_REASONS.has(reason)) throw new ApiError(400, "Select a valid report reason");
  if (details.length > 1000) throw new ApiError(400, "Report details must be 1,000 characters or fewer");
  return { reason, details };
}

export const reportMessage = asyncHandler(async (req, res) => {
  validId(req.params.messageId);
  const message = await Message.findOne({
    _id: req.params.messageId,
    $or: [{ sender: req.user._id }, { recipient: req.user._id }],
  }).lean();
  if (!message) throw new ApiError(404, "Message not found");
  const reportedUser = String(message.sender) === String(req.user._id) ? message.recipient : message.sender;
  const input = reportInput(req);
  try {
    const report = await MessageReport.create({
      reporter: req.user._id,
      reportedUser,
      scope: "MESSAGE",
      message: message._id,
      ...input,
      snapshot: {
        messageId: String(message._id),
        senderId: String(message.sender),
        recipientId: String(message.recipient),
        body: message.body,
        mediaType: message.mediaType,
        image: message.image,
        audio: message.audio,
        video: message.video,
        createdAt: message.createdAt,
        deletedAt: message.deletedAt,
      },
    });
    return sendResponse(res, 201, "Report received", { reportId: String(report._id), status: report.status });
  } catch (error) {
    if (error?.code === 11000) throw new ApiError(409, "You already reported this message");
    throw error;
  }
});

export const reportConversation = asyncHandler(async (req, res) => {
  const other = await assertAllowedPair(req.user, req.params.userId, { allowBlocked: true });
  const input = reportInput(req);
  const rows = await Message.find({
    $or: [{ sender: req.user._id, recipient: other._id }, { sender: other._id, recipient: req.user._id }],
  }).sort({ _id: -1 }).limit(100).lean();
  if (!rows.length) throw new ApiError(404, "Conversation not found");
  const report = await MessageReport.create({
    reporter: req.user._id,
    reportedUser: other._id,
    scope: "CONVERSATION",
    ...input,
    snapshot: {
      participantIds: [String(req.user._id), String(other._id)],
      messages: rows.reverse().map((message) => ({
        messageId: String(message._id),
        senderId: String(message.sender),
        body: message.body,
        mediaType: message.mediaType,
        createdAt: message.createdAt,
        deletedAt: message.deletedAt,
      })),
    },
  });
  return sendResponse(res, 201, "Conversation report received", { reportId: String(report._id), status: report.status });
});

export const blockMessageAccount = asyncHandler(async (req, res) => {
  const other = await assertAllowedPair(req.user, req.params.userId, { allowBlocked: true });
  await UserBlock.updateOne(
    { blocker: req.user._id, blocked: other._id },
    { $setOnInsert: { blocker: req.user._id, blocked: other._id } },
    { upsert: true },
  );
  const payload = { otherUserId: String(req.user._id), blocked: true };
  req.app.get("io")?.to(`user:${other._id}`).emit("account:block", payload);
  return sendResponse(res, 200, "Account blocked", { blockedByMe: true, blockedMe: false });
});

export const unblockMessageAccount = asyncHandler(async (req, res) => {
  validId(req.params.userId);
  const result = await UserBlock.deleteOne({ blocker: req.user._id, blocked: req.params.userId });
  if (!result.deletedCount) throw new ApiError(404, "Blocked account not found");
  req.app.get("io")?.to(`user:${req.params.userId}`).emit("account:block", { otherUserId: String(req.user._id), blocked: false });
  return sendResponse(res, 200, "Account unblocked", { blockedByMe: false });
});

async function reactionMessage(req) {
  assertMessagingAccess(req.user);
  validId(req.params.messageId);
  const message = await Message.findOne({
    _id: req.params.messageId,
    deletedAt: null,
    $or: [{ sender: req.user._id }, { recipient: req.user._id }],
  });
  if (!message) throw new ApiError(404, "Message not found");
  const otherId = message.sender.equals(req.user._id) ? message.recipient : message.sender;
  const blocks = await blockState(req.user._id, otherId);
  if (blocks.blockedByMe || blocks.blockedMe) throw new ApiError(403, "Message reactions are unavailable");
  return message;
}

function emitReaction(req, message) {
  const payload = {
    messageId: String(message._id),
    reactions: message.reactions.map((reaction) => ({ userId: String(reaction.user), emoji: reaction.emoji })),
  };
  const io = req.app.get("io");
  io?.to(`user:${message.sender}`).to(`user:${message.recipient}`).emit("message:reaction", payload);
  return payload;
}

export const setMessageReaction = asyncHandler(async (req, res) => {
  const emoji = String(req.body.emoji || "");
  if (!REACTION_EMOJIS.includes(emoji)) throw new ApiError(400, "Unsupported message reaction");
  const message = await reactionMessage(req);
  message.reactions = message.reactions.filter((reaction) => !reaction.user.equals(req.user._id));
  message.reactions.push({ user: req.user._id, emoji, reactedAt: new Date() });
  await message.save();
  return sendResponse(res, 200, "Message reaction saved", emitReaction(req, message));
});

export const removeMessageReaction = asyncHandler(async (req, res) => {
  const message = await reactionMessage(req);
  message.reactions = message.reactions.filter((reaction) => !reaction.user.equals(req.user._id));
  await message.save();
  return sendResponse(res, 200, "Message reaction removed", emitReaction(req, message));
});

export const acceptMessageRequest = asyncHandler(async (req, res) => {
  if (req.user.role !== "creator") throw new ApiError(403, "Only creators can accept message requests");
  validId(req.params.userId);
  const conversation = await Conversation.findOneAndUpdate(
    { creator: req.user._id, fan: req.params.userId, status: "REQUEST" },
    { $set: { status: "ACTIVE", acceptedAt: new Date(), acceptedByCreator: true, declinedAt: null } },
    { new: true },
  );
  if (!conversation) throw new ApiError(404, "Message request not found");
  req.app.get("io")?.to(`user:${req.params.userId}`).emit("conversation:status", { otherUserId: req.user._id.toString(), status: "ACTIVE" });
  return sendResponse(res, 200, "Message request accepted", { status: conversation.status });
});

export const declineMessageRequest = asyncHandler(async (req, res) => {
  if (req.user.role !== "creator") throw new ApiError(403, "Only creators can decline message requests");
  validId(req.params.userId);
  const conversation = await Conversation.findOneAndUpdate(
    { creator: req.user._id, fan: req.params.userId, status: "REQUEST" },
    { $set: { status: "DECLINED", declinedAt: new Date() } },
    { new: true },
  );
  if (!conversation) throw new ApiError(404, "Message request not found");
  req.app.get("io")?.to(`user:${req.params.userId}`).emit("conversation:status", { otherUserId: req.user._id.toString(), status: "DECLINED" });
  return sendResponse(res, 200, "Message request declined", { status: conversation.status });
});

export const listShareRecipients = asyncHandler(async (req, res) => {
  assertMessagingAccess(req.user);
  const q = String(req.query.q || "").trim().slice(0, 80);
  const limit = Math.min(Math.max(Number(req.query.limit) || 8, 1), 30);
  const blockedIds = await blockedIdsFor(req.user._id);
  blockedIds.add(String(req.user._id));
  const reasonById = new Map();
  const candidateIds = [];
  const addCandidate = (id, reason) => {
    const key = String(id);
    if (!key || blockedIds.has(key) || reasonById.has(key)) return;
    reasonById.set(key, reason);
    candidateIds.push(id);
  };

  const conversationFilter = req.user.role === "creator"
    ? { creator: req.user._id, status: "ACTIVE" }
    : { fan: req.user._id, status: { $in: ["ACTIVE", "REQUEST"] } };
  const conversations = await Conversation.find(conversationFilter).sort({ updatedAt: -1 }).limit(40).lean();
  conversations.forEach((conversation) => addCandidate(req.user.role === "creator" ? conversation.fan : conversation.creator, "Recent chat"));

  const following = await ProfileRelationship.find({ actor: req.user._id, type: "FOLLOW" }).sort({ createdAt: -1 }).limit(60).lean();
  following.forEach((row) => addCandidate(row.target, "Following"));

  if (req.user.role === "creator") {
    const fanFollowers = await ProfileRelationship.find({ target: req.user._id, type: "FOLLOW" }).sort({ createdAt: -1 }).limit(60).lean();
    const activeFanIds = new Set(conversations.map((conversation) => String(conversation.fan)));
    fanFollowers.forEach((row) => {
      if (activeFanIds.has(String(row.actor))) addCandidate(row.actor, "Follows you");
    });
  }

  if (q || candidateIds.length < limit) {
    const searchUsers = await User.find(shareRecipientMatch({ current: req.user, blockedIds, q }))
      .select(userFields)
      .sort({ isVerified: -1, role: 1, name: 1 })
      .limit(30)
      .lean();
    searchUsers.forEach((user) => addCandidate(user._id, q ? "Search result" : "Suggested"));
  }

  const users = await User.find(shareRecipientMatch({ current: req.user, blockedIds, ids: candidateIds, q })).select(userFields).lean();
  const userById = new Map(users.map((user) => [String(user._id), user]));
  let people = candidateIds
    .map((id) => userById.get(String(id)))
    .filter(Boolean);
  const creatorIds = people.filter((user) => user.role === "creator").map((user) => user._id);
  if (creatorIds.length) {
    const profiles = await CreatorProfile.find({ user: { $in: creatorIds }, messagingEnabled: { $ne: false } }).select("user").lean();
    const enabled = new Set(profiles.map((profile) => String(profile.user)));
    people = people.filter((user) => user.role !== "creator" || enabled.has(String(user._id)));
  }
  if (req.user.role === "creator") {
    const activeConversationFanIds = new Set(conversations.map((conversation) => String(conversation.fan)));
    people = people.filter((user) => user.role === "creator" || activeConversationFanIds.has(String(user._id)));
  }
  return sendResponse(res, 200, "Share recipients fetched", {
    people: people.slice(0, limit).map((user) => person(user, reasonById.get(String(user._id)) || "Suggested")),
  });
});

export const sendSharedContent = asyncHandler(async (req, res) => {
  assertMessagingAccess(req.user);
  const rawRecipientIds = Array.isArray(req.body.recipientIds) ? req.body.recipientIds : [];
  const recipientIds = [...new Set(rawRecipientIds.map((id) => String(id || "").trim()).filter(Boolean))].slice(0, 10);
  if (!recipientIds.length) throw new ApiError(400, "Select at least one recipient");
  if (rawRecipientIds.length > 10 || recipientIds.length > 10) throw new ApiError(400, "You can share with up to 10 people at once");
  recipientIds.forEach(validId);
  const text = cleanShareText(req.body.text);
  if (text.length > 2000) throw new ApiError(400, "Message must be 2000 characters or fewer");
  const snapshot = await sharedContentSnapshot(req.body.sharedContent, req.user);
  const sent = [];
  const failed = [];
  const io = req.app.get("io");

  for (const recipientId of recipientIds) {
    try {
      const other = await assertAllowedShareRecipient(req.user, recipientId);
      const conversation = await readyShareConversation(req.user, other);
      const body = text || `Shared a ${contentLabel(snapshot.contentType)}`;
      const clientMessageId = `share:${Date.now()}:${Math.random().toString(36).slice(2, 12)}`;
      const created = await Message.create({
        sender: req.user._id,
        recipient: other._id,
        clientMessageId,
        body,
        mediaType: "text",
        ppm: false,
        messageChannel: "STANDARD",
        directAccessWindow: null,
        sharedContent: snapshot,
      });
      const payload = serializedMessage(created);
      const conversationStatus = conversation?.status || "ACTIVE";
      io?.to(`user:${other._id}`).emit("message:new", { message: payload, participant: person(req.user), conversationStatus });
      sent.push({ recipientId: String(other._id), conversationId: conversation ? String(conversation._id) : null, threadId: String(other._id), message: payload, conversationStatus });
    } catch (error) {
      failed.push({ recipientId, message: error.message || "Could not send" });
    }
  }

  if (!sent.length) throw new ApiError(400, failed[0]?.message || "Could not share this content");
  return sendResponse(res, failed.length ? 207 : 201, failed.length ? "Some shares could not be sent" : "Shared content sent", { sent, failed });
});

export const searchMessagePeople = asyncHandler(async (req, res) => {
  if (req.user.role !== "fan") return sendResponse(res, 200, "People fetched", { people: [] });
  const q = String(req.query.q || "").trim().slice(0, 80);
  const match = { role: "creator", status: "active", creatorApprovalStatus: "approved" };
  if (q) {
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    match.$or = [{ name: { $regex: safe, $options: "i" } }, { username: { $regex: safe, $options: "i" } }];
  }
  const users = await User.find(match).select(userFields).sort({ isVerified: -1, name: 1 }).limit(30).lean();
  const blocks = await UserBlock.find({
    $or: [{ blocker: req.user._id }, { blocked: req.user._id }],
  }).select("blocker blocked").lean();
  const blockedIds = new Set(blocks.flatMap((item) => [String(item.blocker), String(item.blocked)]));
  const profiles = await CreatorProfile.find({ user: { $in: users.map((user) => user._id) }, messagingEnabled: { $ne: false } }).select("user").lean();
  const enabled = new Set(profiles.map((profile) => profile.user.toString()));
  return sendResponse(res, 200, "People fetched", { people: users.filter((user) => enabled.has(user._id.toString()) && !blockedIds.has(user._id.toString())).map(person) });
});
