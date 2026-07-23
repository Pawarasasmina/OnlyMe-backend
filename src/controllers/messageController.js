import mongoose from "mongoose";
import CreatorProfile from "../models/CreatorProfile.js";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import ProfileRelationship from "../models/ProfileRelationship.js";
import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

const userFields = "name username avatar role isVerified status lastSeenAt";
const person = (user) => user && ({ id: user._id.toString(), displayName: user.name, username: user.username, avatarUrl: user.avatar || null, role: user.role, isVerified: Boolean(user.isVerified), lastSeenAt: user.lastSeenAt || null });
const serializedMessage = (message) => ({ id: message._id.toString(), senderId: (message.sender?._id || message.sender).toString(), recipientId: (message.recipient?._id || message.recipient).toString(), body: message.deletedAt ? "Message unavailable" : message.body, mediaType: "text", readAt: message.readAt || null, createdAt: message.createdAt, storyReply: message.storyReply?.story ? { storyId: String(message.storyReply.story), imageUrl: message.storyReply.imageUrl, caption: message.storyReply.caption, expiresAt: message.storyReply.expiresAt || null } : null });
const validId = (value) => {
  if (!mongoose.isValidObjectId(value)) throw new ApiError(400, "Invalid account id");
};

async function assertAllowedPair(current, otherId) {
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
  const messages = await Message.find({ $or: [{ sender: me }, { recipient: me }], deletedAt: null }).sort({ createdAt: -1 }).limit(500).populate("sender recipient", userFields).lean();
  const map = new Map();
  for (const message of messages) {
    const other = message.sender?._id?.equals(me) ? message.recipient : message.sender;
    if (!other || other.status !== "active" || map.has(other._id.toString())) continue;
    map.set(other._id.toString(), { id: other._id.toString(), participant: person(other), lastMessage: serializedMessage(message), unreadCount: 0 });
  }
  for (const message of messages) {
    if (message.recipient?._id?.equals(me) && !message.readAt) {
      const key = message.sender?._id?.toString();
      if (map.has(key)) map.get(key).unreadCount += 1;
    }
  }
  const conversationStates = await Conversation.find(req.user.role === "creator" ? { creator: me } : { fan: me }).lean();
  const stateByOther = new Map(conversationStates.map((item) => [String(req.user.role === "creator" ? item.fan : item.creator), item.status]));
  const conversations = [...map.values()].map((item) => ({ ...item, status: stateByOther.get(item.id) || "ACTIVE" }));
  return sendResponse(res, 200, "Conversations fetched", { conversations });
});

export const listMessages = asyncHandler(async (req, res) => {
  const other = await assertAllowedPair(req.user, req.params.userId);
  const conversation = await conversationFor(req.user, other);
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
  const rows = await Message.find({ $or: [{ sender: req.user._id, recipient: other._id }, { sender: other._id, recipient: req.user._id }], deletedAt: null }).sort({ createdAt: -1 }).limit(limit).lean();
  if (!(req.user.role === "creator" && conversation?.status === "REQUEST")) {
    await Message.updateMany({ sender: other._id, recipient: req.user._id, readAt: null }, { $set: { readAt: new Date() } });
    req.app.get("io")?.to(`user:${other._id}`).emit("messages:read", { byUserId: req.user._id.toString() });
  }
  const followsCreator = req.user.role === "fan"
    ? Boolean(await ProfileRelationship.exists({ actor: req.user._id, target: other._id, type: "FOLLOW" }))
    : null;
  return sendResponse(res, 200, "Messages fetched", {
    participant: person(other),
    messages: rows.reverse().map(serializedMessage),
    conversationStatus: conversation?.status || null,
    requestRequired: req.user.role === "fan" && !followsCreator && (!conversation || (conversation.status === "ACTIVE" && conversation.acceptedByCreator !== true)),
  });
});

export const sendMessage = asyncHandler(async (req, res) => {
  const other = await assertAllowedPair(req.user, req.params.userId);
  const body = String(req.body.body || "").trim();
  if (!body) throw new ApiError(400, "Message text is required");
  if (body.length > 2000) throw new ApiError(400, "Message must be 2000 characters or fewer");
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
  const created = await Message.create({ sender: req.user._id, recipient: other._id, body, mediaType: "text", ppm: false });
  const payload = serializedMessage(created);
  req.app.get("io")?.to(`user:${other._id}`).emit("message:new", { message: payload, participant: person(req.user), conversationStatus: conversation.status });
  return sendResponse(res, 201, conversation.status === "REQUEST" ? "Message request sent" : "Message sent", { message: payload, conversationStatus: conversation.status });
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
  const profiles = await CreatorProfile.find({ user: { $in: users.map((user) => user._id) }, messagingEnabled: { $ne: false } }).select("user").lean();
  const enabled = new Set(profiles.map((profile) => profile.user.toString()));
  return sendResponse(res, 200, "People fetched", { people: users.filter((user) => enabled.has(user._id.toString())).map(person) });
});
