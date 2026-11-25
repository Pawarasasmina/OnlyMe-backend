import { redactPreciseLocation } from "../utils/wallMeetupSafety.js";
import { readWallArea } from "./wallMeetupSafetyService.js";
import mongoose from "mongoose";
import User from "../models/User.js";
import Conversation from "../models/Conversation.js";
import GroupConversation from "../models/GroupConversation.js";

const privateKeys = new Set(["lastSeenAt", "lastActiveAt", "lastActivityAt", "last_active_at", "last_seen_at", "lastHeartbeatAt", "foregroundAt", "presenceState", "online", "isOnline", "activeNow"]);
const scalarObject = value => value instanceof Date || typeof value?.toHexString === "function";
export function stripActivityTimes(value) {
  if (scalarObject(value)) return value;
  if (value && typeof value.toJSON === "function") value = value.toJSON();
  if (Array.isArray(value)) return value.map(stripActivityTimes);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !privateKeys.has(key)).map(([key, item]) => {
    if (key === "activeStatus" && item && typeof item === "object") {
      if (item.isActive === false) return [key, null];
      const status = Object.fromEntries(Object.entries(item).filter(([field]) => !["startedAt", "updatedAt"].includes(field)));
      return [key, stripActivityTimes(status)];
    }
    return [key, stripActivityTimes(item)];
  }));
}

export function maskReceipts(value, viewerId, preferences) {
  if (scalarObject(value)) return value;
  if (Array.isArray(value)) return value.map(item => maskReceipts(item, viewerId, preferences));
  if (!value || typeof value !== "object") return value;
  const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, maskReceipts(item, viewerId, preferences)]));
  const allowed = id => preferences.get(String(id)) === true;
  if (Object.hasOwn(result, "readAt") && result.senderId && result.recipientId) result.readAt = allowed(viewerId) && allowed(result.senderId) && allowed(result.recipientId) ? Boolean(result.readAt) : null;
  if (Array.isArray(result.readBy)) result.readBy = allowed(viewerId) && allowed(result.senderId) ? result.readBy.filter(row => allowed(row.userId)).map(row => ({ userId: row.userId, read: true })) : [];
  if (Array.isArray(result.deliveredBy)) result.deliveredBy = result.deliveredBy.map(row => ({ userId: row.userId, delivered: true }));
  return result;
}

async function receiptPreferences(clean, viewers) {
  const ids = new Set(viewers.map(String));
  let hasReceipts = false;
  function collect(item) {
    if (!item || typeof item !== "object") return;
    if (Object.hasOwn(item, "readAt") && item.senderId || Array.isArray(item.readBy)) hasReceipts = true;
    for (const key of ["senderId", "recipientId", "userId"]) if (mongoose.isValidObjectId(item[key])) ids.add(String(item[key]));
    Object.values(item).forEach(collect);
  }
  collect(clean);
  if (!hasReceipts) return null;
  const users = await User.find({ _id: { $in: [...ids] } }).select("read_receipts").lean();
  return new Map(users.map(user => [String(user._id), user.read_receipts !== false]));
}

export function protectPublicWallData(value) {
  if (scalarObject(value)) return value;
  if (value && typeof value.toJSON === "function") value = value.toJSON();
  if (Array.isArray(value)) return value.map(protectPublicWallData);
  if (!value || typeof value !== "object") return value;
  const result = Object.fromEntries(Object.entries(value).map(([key,item]) => [key,protectPublicWallData(item)]));
  const wall = (result.text && result.author) || Object.hasOwn(result,"postType") || result.type === "post" || result.entityType === "feed_post" || (result.context && result.text && result.creator && result.media);
  if (wall && result.status !== "draft") {
    for (const field of ["text","title","description","summary","shareCaption"]) if (typeof result[field] === "string") result[field] = redactPreciseLocation(result[field]);
    if (typeof result.location === "string") result.location = result.publicArea || readWallArea(result.location,null,result.countryCode);
    else if (result.location && typeof result.location === "object") result.location = { city: readWallArea(result.location.city,null,result.countryCode), country: result.location.country || "" };
    for (const field of ["latitude","longitude","lat","lon","lng","coordinates","liveLocation","exactLocation","address","privateAddress"]) delete result[field];
    if (Array.isArray(result.media)) result.media = result.media.map(item => ({...item,...(item.transcript ? {transcript:redactPreciseLocation(item.transcript)} : {}), ...(Array.isArray(item.translations) ? {translations:item.translations.map(row=>({...row,text:redactPreciseLocation(row.text)}))} : {})}));
  }
  return result;
}

export async function privateResponse(data, viewerId, { allowWallEvidence = false } = {}) {
  const clean = stripActivityTimes(allowWallEvidence ? data : protectPublicWallData(data));
  if (!viewerId) return clean;
  const preferences = await receiptPreferences(clean, [viewerId]);
  return preferences ? maskReceipts(clean, viewerId, preferences) : clean;
}

export async function emitPrivateMessages(io, viewerIds, event, data) {
  if (!io) return;
  const clean = stripActivityTimes(data);
  const preferences = await receiptPreferences(clean, viewerIds);
  for (const viewerId of viewerIds) io.to(`user:${viewerId}`).emit(event, preferences ? maskReceipts(clean, viewerId, preferences) : clean);
}

export async function emitPrivateMessage(io, viewerId, event, data) {
  if (!io) return;
  if (data === undefined) { io.to(`user:${viewerId}`).emit(event); return; }
  const filtered = await privateResponse(data, viewerId);
  if (event === "messages:read" && !filtered.readAt) return;
  io.to(`user:${viewerId}`).emit(event, filtered);
}

export async function notifyPrivacyRefresh(io, userId) {
  if (!io) return;
  const [conversations, groups] = await Promise.all([
    Conversation.find({ $or: [{ participants: userId }, { fan: userId }, { creator: userId }] }).select("participants fan creator").lean(),
    GroupConversation.find({ members: userId, deletedAt: null }).select("members").lean(),
  ]);
  const ids = new Set([String(userId)]);
  for (const conversation of conversations) for (const id of [...(conversation.participants || []), conversation.fan, conversation.creator].filter(Boolean)) ids.add(String(id));
  for (const group of groups) for (const id of group.members) ids.add(String(id));
  for (const socket of io.sockets?.sockets?.values?.() || []) if (socket.data.presenceTargets?.has(String(userId))) ids.add(String(socket.user._id));
  for (const id of ids) io.to(`user:${id}`).emit("privacy:refresh");
}
