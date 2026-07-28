import mongoose from "mongoose";
import CreatorProfile from "../models/CreatorProfile.js";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import MessageReport from "../models/MessageReport.js";
import ProfileRelationship from "../models/ProfileRelationship.js";
import User from "../models/User.js";
import UserBlock from "../models/UserBlock.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { messageVoiceUrl, uploadMessageVoice } from "../services/messageVoiceStorageService.js";
import { messageVideoUrl, uploadMessageVideo } from "../services/messageVideoStorageService.js";
import { messageImageUrl, uploadMessageImage } from "../services/messageImageStorageService.js";

const userFields = "name username avatar role isVerified status lastSeenAt";
const person = (user) => user && ({ id: user._id.toString(), displayName: user.name, username: user.username, avatarUrl: user.avatar || null, role: user.role, isVerified: Boolean(user.isVerified), lastSeenAt: user.lastSeenAt || null });
const REACTION_EMOJIS = ["❤️", "😂", "😮", "😢", "😡", "👍"];
const serializedReply = (reply) => reply ? {
  id: String(reply._id || reply),
  senderId: reply.sender ? String(reply.sender?._id || reply.sender) : null,
  body: reply.deletedAt ? "Message unavailable" : reply.body || "Original message",
} : null;
const serializedMessage = (message) => ({ id: message._id.toString(), clientMessageId: message.clientMessageId || null, senderId: (message.sender?._id || message.sender).toString(), recipientId: (message.recipient?._id || message.recipient).toString(), body: message.deletedAt ? "This message was deleted" : message.body, mediaType: message.mediaType || "text", deletedAt: message.deletedAt || null, image: !message.deletedAt && message.mediaType === "image" && message.image?.assetId ? { url: messageImageUrl(message.image), width: message.image.width, height: message.image.height } : null, audio: !message.deletedAt && message.mediaType === "audio" && message.audio?.assetId ? { url: messageVoiceUrl(message.audio), duration: message.audio.duration, waveform: message.audio.waveform || [] } : null, video: !message.deletedAt && message.mediaType === "video" && message.video?.assetId ? { url: messageVideoUrl(message.video), duration: message.video.duration, width: message.video.width, height: message.video.height } : null, readAt: message.readAt || null, createdAt: message.createdAt, replyTo: serializedReply(message.replyTo), reactions: message.deletedAt ? [] : (message.reactions || []).map((reaction) => ({ userId: String(reaction.user?._id || reaction.user), emoji: reaction.emoji })), storyReply: !message.deletedAt && message.storyReply?.story ? { storyId: String(message.storyReply.story), imageUrl: message.storyReply.imageUrl, caption: message.storyReply.caption, expiresAt: message.storyReply.expiresAt || null } : null });
const validId = (value) => {
  if (!mongoose.isValidObjectId(value)) throw new ApiError(400, "Invalid account id");
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
  if (!roles.has("fan") || !roles.has("creator")) throw new ApiError(403, "Messages are currently available only between fans and creators");
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

const pairFor = (current, other) => current.role === "fan"
  ? { fan: current._id, creator: other._id }
  : { fan: other._id, creator: current._id };

async function conversationFor(current, other) {
  const pair = pairFor(current, other);
  let conversation = await Conversation.findOne(pair);
  if (!conversation) {
    const hasMessages = await Message.exists({ $or: [{ sender: pair.fan, recipient: pair.creator }, { sender: pair.creator, recipient: pair.fan }] });
    if (hasMessages) conversation = await Conversation.findOneAndUpdate(pair, { $setOnInsert: { ...pair, status: "ACTIVE", acceptedAt: new Date(), acceptedByCreator: false } }, { new: true, upsert: true });
  }
  return conversation;
}

export const listConversations = asyncHandler(async (req, res) => {
  const me = req.user._id;
  const grouped = await Message.aggregate([
    { $match: { $or: [{ sender: me }, { recipient: me }], deletedAt: null, deletedFor: { $ne: me } } },
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
  const messageFilter = {
    $or: [{ sender: req.user._id, recipient: other._id }, { sender: other._id, recipient: req.user._id }],
    deletedFor: { $ne: req.user._id },
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
  });
});

export const sendMessage = asyncHandler(async (req, res) => {
  const other = await assertAllowedPair(req.user, req.params.userId);
  const body = String(req.body.body || "").trim();
  if (!body) throw new ApiError(400, "Message text is required");
  if (body.length > 2000) throw new ApiError(400, "Message must be 2000 characters or fewer");
  const clientMessageId = String(req.body.clientMessageId || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(clientMessageId)) {
    throw new ApiError(400, "A valid client message id is required");
  }
  let conversation = await conversationFor(req.user, other);
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
  try {
    created = await Message.create({ sender: req.user._id, recipient: other._id, clientMessageId, body, mediaType: "text", ppm: false, replyTo: replyTo?._id || null });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    created = await Message.findOne({ sender: req.user._id, clientMessageId });
    if (!created) throw error;
    createdNow = false;
  }
  if (replyTo) await created.populate("replyTo", "sender body deletedAt");
  const payload = serializedMessage(created);
  if (createdNow) {
    req.app.get("io")?.to(`user:${other._id}`).emit("message:new", { message: payload, participant: person(req.user), conversationStatus: conversation.status });
  }
  return sendResponse(res, createdNow ? 201 : 200, createdNow ? conversation.status === "REQUEST" ? "Message request sent" : "Message sent" : "Message already sent", { message: payload, conversationStatus: conversation.status, idempotentReplay: !createdNow });
});

export const sendVoiceMessage = asyncHandler(async (req, res) => {
  const other = await assertAllowedPair(req.user, req.params.userId);
  if (!req.file?.buffer) throw new ApiError(400, "A voice recording is required");
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
  const created = await Message.create({ sender: req.user._id, recipient: other._id, body: "Voice message", mediaType: "audio", ppm: false, audio: { ...audio, waveform } });
  const payload = serializedMessage(created);
  req.app.get("io")?.to(`user:${other._id}`).emit("message:new", { message: payload, participant: person(req.user), conversationStatus: conversation.status });
  return sendResponse(res, 201, conversation.status === "REQUEST" ? "Voice-message request sent" : "Voice message sent", { message: payload, conversationStatus: conversation.status });
});

export const sendVideoNote = asyncHandler(async (req, res) => {
  const other = await assertAllowedPair(req.user, req.params.userId);
  if (!req.file?.buffer) throw new ApiError(400, "A video note is required");
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
  const created = await Message.create({ sender: req.user._id, recipient: other._id, body: "Video note", mediaType: "video", ppm: false, video });
  const payload = serializedMessage(created);
  req.app.get("io")?.to(`user:${other._id}`).emit("message:new", { message: payload, participant: person(req.user), conversationStatus: conversation.status });
  return sendResponse(res, 201, conversation.status === "REQUEST" ? "Video-note request sent" : "Video note sent", { message: payload, conversationStatus: conversation.status });
});

export const sendImageMessage = asyncHandler(async (req, res) => {
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
  const created = await Message.create({ sender: req.user._id, recipient: other._id, clientMessageId, body: caption || "Image", mediaType: "image", image });
  const payload = serializedMessage(created);
  req.app.get("io")?.to(`user:${other._id}`).emit("message:new", { message: payload, participant: person(req.user), conversationStatus: conversation.status });
  return sendResponse(res, 201, conversation.status === "REQUEST" ? "Image-message request sent" : "Image sent", { message: payload, conversationStatus: conversation.status });
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
