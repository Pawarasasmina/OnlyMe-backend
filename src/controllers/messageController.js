import mongoose from "mongoose";
import CreatorProfile from "../models/CreatorProfile.js";
import Message from "../models/Message.js";
import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

const userFields = "name username avatar role isVerified status lastSeenAt";
const person = (user) => user && ({ id: user._id.toString(), displayName: user.name, username: user.username, avatarUrl: user.avatar || null, role: user.role, isVerified: Boolean(user.isVerified), lastSeenAt: user.lastSeenAt || null });
const serializedMessage = (message) => ({ id: message._id.toString(), senderId: (message.sender?._id || message.sender).toString(), recipientId: (message.recipient?._id || message.recipient).toString(), body: message.deletedAt ? "Message unavailable" : message.body, mediaType: "text", readAt: message.readAt || null, createdAt: message.createdAt });

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
  return sendResponse(res, 200, "Conversations fetched", { conversations: [...map.values()] });
});

export const listMessages = asyncHandler(async (req, res) => {
  const other = await assertAllowedPair(req.user, req.params.userId);
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
  const rows = await Message.find({ $or: [{ sender: req.user._id, recipient: other._id }, { sender: other._id, recipient: req.user._id }], deletedAt: null }).sort({ createdAt: -1 }).limit(limit).lean();
  await Message.updateMany({ sender: other._id, recipient: req.user._id, readAt: null }, { $set: { readAt: new Date() } });
  req.app.get("io")?.to(`user:${other._id}`).emit("messages:read", { byUserId: req.user._id.toString() });
  return sendResponse(res, 200, "Messages fetched", { participant: person(other), messages: rows.reverse().map(serializedMessage) });
});

export const sendMessage = asyncHandler(async (req, res) => {
  const other = await assertAllowedPair(req.user, req.params.userId);
  const body = String(req.body.body || "").trim();
  if (!body) throw new ApiError(400, "Message text is required");
  if (body.length > 2000) throw new ApiError(400, "Message must be 2000 characters or fewer");
  const created = await Message.create({ sender: req.user._id, recipient: other._id, body, mediaType: "text", ppm: false });
  const payload = serializedMessage(created);
  req.app.get("io")?.to(`user:${other._id}`).emit("message:new", { message: payload, participant: person(req.user) });
  return sendResponse(res, 201, "Message sent", { message: payload });
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
