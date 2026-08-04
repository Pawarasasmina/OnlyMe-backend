import mongoose from "mongoose";
import GroupConversation from "../models/GroupConversation.js";
import GroupMessage from "../models/GroupMessage.js";
import User from "../models/User.js";
import UserBlock from "../models/UserBlock.js";
import MessageReport from "../models/MessageReport.js";
import Message from "../models/Message.js";
import Conversation from "../models/Conversation.js";
import ProfileRelationship from "../models/ProfileRelationship.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { deleteGroupAvatar, uploadGroupAvatar } from "../services/groupAvatarStorageService.js";

const person = (user) => ({ id: String(user._id), displayName: user.name, username: user.username, avatarUrl: user.avatar || null, role: user.role, isVerified: Boolean(user.isVerified) });
const serializeMessage = (message) => ({ id: String(message._id), clientMessageId: message.clientMessageId || null, groupId: String(message.group), senderId: String(message.sender?._id || message.sender), sender: message.sender?.name ? person(message.sender) : null, body: message.deletedAt ? "This message was deleted" : message.body, deletedAt: message.deletedAt || null, forwarded: Boolean(message.forwardedFrom), replyTo: message.replyTo ? { id: String(message.replyTo._id), senderId: String(message.replyTo.sender), body: message.replyTo.deletedAt ? "Message unavailable" : message.replyTo.body } : null, reactions: (message.reactions || []).map((item) => ({ userId: String(item.user), emoji: item.emoji })), deliveredBy: (message.deliveredBy || []).map((item) => ({ userId: String(item.user), deliveredAt: item.deliveredAt })), readBy: (message.readBy || []).map((item) => ({ userId: String(item.user), readAt: item.readAt })), createdAt: message.createdAt });
const serializeGroup = (group, me, lastMessage = null, unreadCount = 0, pinnedGroupId = null) => ({ id: String(group._id), type: "group", name: group.name, avatarUrl: group.avatar || null, createdBy: String(group.createdBy), members: (group.members || []).map((item) => item?.name ? person(item) : { id: String(item) }), admins: (group.admins || []).map(String), permissions: { editGroupInfo: group.permissions?.editGroupInfo || "ADMINS", addMembers: group.permissions?.addMembers || "ADMINS" }, archived: (group.archivedBy || []).some((id) => String(id) === String(me)), muted: (group.mutedBy || []).some((id) => String(id) === String(me)), pinnedToProfile: String(pinnedGroupId || "") === String(group._id), lastMessage: lastMessage ? serializeMessage(lastMessage) : null, unreadCount });
const isGroupAdmin = (group, userId) => group.admins.some((id) => String(id) === String(userId));
const canEditGroupInfo = (group, userId) => isGroupAdmin(group, userId) || group.permissions?.editGroupInfo === "ALL_MEMBERS";
const canAddGroupMembers = (group, userId) => isGroupAdmin(group, userId) || group.permissions?.addMembers === "ALL_MEMBERS";
const validId = (value) => { if (!mongoose.isValidObjectId(value)) throw new ApiError(400, "Invalid group id"); };
const getGroup = async (groupId, userId) => {
  validId(groupId);
  const group = await GroupConversation.findOne({ _id: groupId, members: userId, deletedAt: null });
  if (!group) throw new ApiError(404, "Group not found");
  return group;
};

export const listGroups = asyncHandler(async (req, res) => {
  const owner = await User.findById(req.user._id).select("pinnedMessageGroup").lean();
  const groups = await GroupConversation.find({ members: req.user._id, deletedAt: null }).populate("members", "name username avatar role isVerified").sort({ updatedAt: -1 }).lean();
  const ids = groups.map((group) => group._id);
  const latest = await GroupMessage.aggregate([{ $match: { group: { $in: ids }, deletedFor: { $ne: req.user._id } } }, { $sort: { createdAt: -1 } }, { $group: { _id: "$group", message: { $first: "$$ROOT" }, unreadCount: { $sum: { $cond: [{ $and: [{ $ne: ["$sender", req.user._id] }, { $not: [{ $in: [req.user._id, "$readBy.user"] }] }] }, 1, 0] } } } }]);
  const byGroup = new Map(latest.map((item) => [String(item._id), item]));
  return sendResponse(res, 200, "Groups fetched", { groups: groups.map((group) => { const data = byGroup.get(String(group._id)); return serializeGroup(group, req.user._id, data?.message, data?.unreadCount || 0, owner?.pinnedMessageGroup); }) });
});

export const createGroup = asyncHandler(async (req, res) => {
  const name = String(req.body.name || "").trim();
  const memberIds = [...new Set((req.body.memberIds || []).map(String).filter((id) => mongoose.isValidObjectId(id) && id !== String(req.user._id)))];
  if (!name || name.length > 60) throw new ApiError(400, "A group name is required");
  if (memberIds.length < 1 || memberIds.length > 99) throw new ApiError(400, "Choose between 1 and 99 other members");
  const users = await User.find({ _id: { $in: memberIds }, status: "active" }).select("_id").lean();
  if (users.length !== memberIds.length) throw new ApiError(400, "One or more members are unavailable");
  const blocked = await UserBlock.exists({ $or: [{ blocker: req.user._id, blocked: { $in: memberIds } }, { blocker: { $in: memberIds }, blocked: req.user._id }] });
  if (blocked) throw new ApiError(403, "A blocked account cannot be added to this group");
  const group = await GroupConversation.create({ name, avatar: String(req.body.avatarUrl || ""), createdBy: req.user._id, members: [req.user._id, ...memberIds], admins: [req.user._id] });
  await group.populate("members", "name username avatar role isVerified");
  req.app.get("io")?.to(memberIds.map((id) => `user:${id}`)).emit("group:created", serializeGroup(group, req.user._id));
  return sendResponse(res, 201, "Group created", { group: serializeGroup(group, req.user._id) });
});

export const getGroupMessages = asyncHandler(async (req, res) => {
  const group = await getGroup(req.params.groupId, req.user._id);
  const owner = await User.findById(req.user._id).select("pinnedMessageGroup").lean();
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const filter = { group: group._id, deletedFor: { $ne: req.user._id } };
  if (req.query.cursor) { validId(req.query.cursor); filter._id = { $lt: req.query.cursor }; }
  const rows = await GroupMessage.find(filter).sort({ _id: -1 }).limit(limit + 1).populate("sender", "name username avatar role isVerified").populate("replyTo", "sender body deletedAt").lean();
  const receiptAt = new Date();
  const receiptFilter = { group: group._id, sender: { $ne: req.user._id }, $or: [{ "deliveredBy.user": { $ne: req.user._id } }, { "readBy.user": { $ne: req.user._id } }] };
  const receiptRows = await GroupMessage.find(receiptFilter).select("_id sender deliveredBy readBy");
  for (const message of receiptRows) {
    if (!message.deliveredBy.some((item) => item.user.equals(req.user._id))) message.deliveredBy.push({ user: req.user._id, deliveredAt: receiptAt });
    if (!message.readBy.some((item) => item.user.equals(req.user._id))) message.readBy.push({ user: req.user._id, readAt: receiptAt });
    await message.save();
    const payload = { groupId: String(group._id), messageId: String(message._id), deliveredBy: message.deliveredBy.map((item) => ({ userId: String(item.user), deliveredAt: item.deliveredAt })), readBy: message.readBy.map((item) => ({ userId: String(item.user), readAt: item.readAt })) };
    for (const memberId of group.members) req.app.get("io")?.to(`user:${memberId}`).emit("group:receipt", payload);
  }
  const page = rows.slice(0, limit);
  await group.populate("members", "name username avatar role isVerified");
  const receivedIds = new Set(receiptRows.map((item) => String(item._id)));
  return sendResponse(res, 200, "Group messages fetched", { group: serializeGroup(group, req.user._id, null, 0, owner?.pinnedMessageGroup), messages: page.reverse().map((message) => { if (receivedIds.has(String(message._id))) { message.deliveredBy = [...(message.deliveredBy || []).filter((item) => String(item.user) !== String(req.user._id)), { user: req.user._id, deliveredAt: receiptAt }]; message.readBy = [...(message.readBy || []).filter((item) => String(item.user) !== String(req.user._id)), { user: req.user._id, readAt: receiptAt }]; } return serializeMessage(message); }), pageInfo: { hasMore: rows.length > limit, nextCursor: rows.length > limit ? String(page[page.length - 1]._id) : null } });
});

export const sendGroupMessage = asyncHandler(async (req, res) => {
  const group = await getGroup(req.params.groupId, req.user._id);
  const body = String(req.body.body || "").trim();
  if (!body || body.length > 2000) throw new ApiError(400, "Message must be between 1 and 2000 characters");
  let replyTo = null;
  if (req.body.replyToId) replyTo = await GroupMessage.findOne({ _id: req.body.replyToId, group: group._id });
  let message = req.body.clientMessageId ? await GroupMessage.findOne({ group: group._id, sender: req.user._id, clientMessageId: req.body.clientMessageId }) : null;
  if (!message) message = await GroupMessage.create({ group: group._id, sender: req.user._id, clientMessageId: req.body.clientMessageId || null, body, replyTo: replyTo?._id || null, deliveredBy: [{ user: req.user._id }], readBy: [{ user: req.user._id }] });
  await message.populate("sender", "name username avatar role isVerified");
  if (replyTo) message.replyTo = replyTo;
  group.archivedBy = [];
  await group.save();
  const payload = serializeMessage(message);
  for (const memberId of group.members) req.app.get("io")?.to(`user:${memberId}`).emit("group:message", { groupId: String(group._id), message: payload });
  return sendResponse(res, 201, "Group message sent", { message: payload });
});

export const updateGroup = asyncHandler(async (req, res) => {
  const group = await getGroup(req.params.groupId, req.user._id);
  if (req.body.permissions !== undefined) {
    if (!isGroupAdmin(group, req.user._id)) throw new ApiError(403, "Only a group admin can change group permissions");
    for (const key of ["editGroupInfo", "addMembers"]) if (req.body.permissions[key] !== undefined) {
      if (!["ADMINS", "ALL_MEMBERS"].includes(req.body.permissions[key])) throw new ApiError(400, "Invalid group permission");
      group.permissions[key] = req.body.permissions[key];
    }
  }
  if (req.body.name !== undefined) { if (!canEditGroupInfo(group, req.user._id)) throw new ApiError(403, "You cannot edit this group's info"); const name = String(req.body.name).trim(); if (!name || name.length > 60) throw new ApiError(400, "Invalid group name"); group.name = name; }
  await group.save();
  return sendResponse(res, 200, "Group updated", { group: serializeGroup(group, req.user._id) });
});

export const updateGroupAvatar = asyncHandler(async (req, res) => {
  const group = await getGroup(req.params.groupId, req.user._id);
  if (!canEditGroupInfo(group, req.user._id)) throw new ApiError(403, "You cannot edit this group's image");
  if (!req.file?.buffer) throw new ApiError(400, "Choose a group image");
  group.avatar = await uploadGroupAvatar({ buffer: req.file.buffer, groupId: group._id, userId: req.user._id });
  await group.save();
  await group.populate("members", "name username avatar role isVerified");
  const payload = serializeGroup(group, req.user._id);
  for (const memberId of group.members) req.app.get("io")?.to(`user:${memberId._id || memberId}`).emit("group:updated", payload);
  return sendResponse(res, 200, "Group image updated", { group: payload });
});

export const removeGroupAvatar = asyncHandler(async (req, res) => {
  const group = await getGroup(req.params.groupId, req.user._id);
  if (!canEditGroupInfo(group, req.user._id)) throw new ApiError(403, "You cannot edit this group's image");
  if (group.avatar) await deleteGroupAvatar(group._id).catch(() => {});
  group.avatar = "";
  await group.save();
  await group.populate("members", "name username avatar role isVerified");
  const payload = serializeGroup(group, req.user._id);
  for (const memberId of group.members) req.app.get("io")?.to(`user:${memberId._id || memberId}`).emit("group:updated", payload);
  return sendResponse(res, 200, "Group image removed", { group: payload });
});

export const addGroupMember = asyncHandler(async (req, res) => {
  const group = await getGroup(req.params.groupId, req.user._id);
  if (!canAddGroupMembers(group, req.user._id)) throw new ApiError(403, "You cannot add members to this group");
  const member = await User.findOne({ _id: req.body.userId, status: "active" });
  if (!member) throw new ApiError(404, "Account not found");
  if (!group.members.some((id) => id.equals(member._id))) group.members.push(member._id);
  await group.save();
  return sendResponse(res, 200, "Member added", {});
});

export const removeGroupMember = asyncHandler(async (req, res) => {
  const group = await getGroup(req.params.groupId, req.user._id);
  const target = String(req.params.userId);
  const leaving = target === String(req.user._id);
  if (!leaving && !group.admins.some((id) => id.equals(req.user._id))) throw new ApiError(403, "Only a group admin can remove members");
  group.members = group.members.filter((id) => String(id) !== target);
  group.admins = group.admins.filter((id) => String(id) !== target);
  if (!group.members.length) group.deletedAt = new Date();
  else if (!group.admins.length) group.admins = [group.members[0]];
  await group.save();
  return sendResponse(res, 200, leaving ? "You left the group" : "Member removed", {});
});

export const setGroupAdmin = asyncHandler(async (req, res) => {
  const group = await getGroup(req.params.groupId, req.user._id);
  if (!group.admins.some((id) => id.equals(req.user._id))) throw new ApiError(403, "Only a group admin can manage admins");
  const target = String(req.params.userId);
  if (!group.members.some((id) => String(id) === target)) throw new ApiError(404, "Group member not found");
  if (req.body.admin === false) group.admins = group.admins.filter((id) => String(id) !== target);
  else if (!group.admins.some((id) => String(id) === target)) group.admins.push(target);
  if (!group.admins.length) throw new ApiError(400, "A group must have at least one admin");
  await group.save();
  return sendResponse(res, 200, "Admin role updated", {});
});

export const archiveGroup = asyncHandler(async (req, res) => { const group = await getGroup(req.params.groupId, req.user._id); if (req.body.archived === false) group.archivedBy.pull(req.user._id); else group.archivedBy.addToSet(req.user._id); await group.save(); return sendResponse(res, 200, "Archive updated", { archived: req.body.archived !== false }); });

export const muteGroup = asyncHandler(async (req, res) => { const group = await getGroup(req.params.groupId, req.user._id); const muted = req.body.muted !== false; if (muted) group.mutedBy.addToSet(req.user._id); else group.mutedBy.pull(req.user._id); await group.save(); return sendResponse(res, 200, muted ? "Group muted" : "Group unmuted", { muted }); });

export const pinGroupToProfile = asyncHandler(async (req, res) => { const group = await getGroup(req.params.groupId, req.user._id); const pinned = req.body.pinned !== false; await User.updateOne({ _id: req.user._id }, { $set: { pinnedMessageGroup: pinned ? group._id : null } }); return sendResponse(res, 200, pinned ? "Group pinned to profile" : "Group removed from profile", { pinned, groupId: pinned ? String(group._id) : null }); });

export const deleteGroup = asyncHandler(async (req, res) => { const group = await getGroup(req.params.groupId, req.user._id); if (!group.createdBy.equals(req.user._id)) throw new ApiError(403, "Only the group creator can delete this group"); group.deletedAt = new Date(); await group.save(); return sendResponse(res, 200, "Group deleted", {}); });

export const setGroupMessageReaction = asyncHandler(async (req, res) => {
  const message = await GroupMessage.findById(req.params.messageId);
  if (!message) throw new ApiError(404, "Message not found");
  const group = await getGroup(message.group, req.user._id);
  const emoji = String(req.body.emoji || "");
  if (!["❤️", "😂", "😮", "😢", "😡", "👍"].includes(emoji)) throw new ApiError(400, "Unsupported reaction");
  message.reactions = message.reactions.filter((item) => !item.user.equals(req.user._id));
  message.reactions.push({ user: req.user._id, emoji });
  await message.save();
  const reactions = message.reactions.map((item) => ({ userId: String(item.user), emoji: item.emoji }));
  for (const memberId of group.members) req.app.get("io")?.to(`user:${memberId}`).emit("group:reaction", { groupId: String(group._id), messageId: String(message._id), reactions });
  return sendResponse(res, 200, "Reaction saved", { reactions });
});

export const markGroupMessageDelivered = asyncHandler(async (req, res) => {
  const message = await GroupMessage.findById(req.params.messageId);
  if (!message) throw new ApiError(404, "Message not found");
  const group = await getGroup(message.group, req.user._id);
  if (!message.deliveredBy.some((item) => item.user.equals(req.user._id))) {
    message.deliveredBy.push({ user: req.user._id, deliveredAt: new Date() });
  }
  if (req.body.read === true && !message.readBy.some((item) => item.user.equals(req.user._id))) message.readBy.push({ user: req.user._id, readAt: new Date() });
  await message.save();
  const payload = { groupId: String(group._id), messageId: String(message._id), deliveredBy: message.deliveredBy.map((item) => ({ userId: String(item.user), deliveredAt: item.deliveredAt })), readBy: message.readBy.map((item) => ({ userId: String(item.user), readAt: item.readAt })) };
  for (const memberId of group.members) req.app.get("io")?.to(`user:${memberId}`).emit("group:receipt", payload);
  return sendResponse(res, 200, req.body.read === true ? "Message seen" : "Message delivered", payload);
});

export const syncGroupMessageDeliveries = asyncHandler(async (req, res) => {
  const groups = await GroupConversation.find({ members: req.user._id, deletedAt: null }).select("_id members");
  const groupById = new Map(groups.map((group) => [String(group._id), group]));
  const messages = await GroupMessage.find({ group: { $in: groups.map((group) => group._id) }, sender: { $ne: req.user._id }, "deliveredBy.user": { $ne: req.user._id } }).select("_id group deliveredBy readBy").limit(500);
  const deliveredAt = new Date();
  for (const message of messages) {
    message.deliveredBy.push({ user: req.user._id, deliveredAt });
    await message.save();
    const group = groupById.get(String(message.group));
    const payload = { groupId: String(message.group), messageId: String(message._id), deliveredBy: message.deliveredBy.map((item) => ({ userId: String(item.user), deliveredAt: item.deliveredAt })), readBy: message.readBy.map((item) => ({ userId: String(item.user), readAt: item.readAt })) };
    for (const memberId of group?.members || []) req.app.get("io")?.to(`user:${memberId}`).emit("group:receipt", payload);
  }
  return sendResponse(res, 200, "Group deliveries synchronized", { deliveredCount: messages.length });
});

export const removeGroupMessageReaction = asyncHandler(async (req, res) => {
  const message = await GroupMessage.findById(req.params.messageId);
  if (!message) throw new ApiError(404, "Message not found");
  const group = await getGroup(message.group, req.user._id);
  message.reactions = message.reactions.filter((item) => !item.user.equals(req.user._id));
  await message.save();
  const reactions = message.reactions.map((item) => ({ userId: String(item.user), emoji: item.emoji }));
  for (const memberId of group.members) req.app.get("io")?.to(`user:${memberId}`).emit("group:reaction", { groupId: String(group._id), messageId: String(message._id), reactions });
  return sendResponse(res, 200, "Reaction removed", { reactions });
});

export const deleteGroupMessage = asyncHandler(async (req, res) => {
  const message = await GroupMessage.findById(req.params.messageId);
  if (!message) throw new ApiError(404, "Message not found");
  const group = await getGroup(message.group, req.user._id);
  const scope = req.query.scope === "everyone" ? "everyone" : "me";
  if (scope === "everyone") {
    if (!message.sender.equals(req.user._id)) throw new ApiError(403, "Only the sender can unsend this message");
    message.deletedAt = new Date();
    message.reactions = [];
  } else message.deletedFor.addToSet(req.user._id);
  await message.save();
  const payload = { groupId: String(group._id), messageId: String(message._id), scope, deletedAt: message.deletedAt || null, hiddenForUserId: scope === "me" ? String(req.user._id) : null };
  for (const memberId of group.members) req.app.get("io")?.to(`user:${memberId}`).emit("group:message-deleted", payload);
  return sendResponse(res, 200, scope === "everyone" ? "Message unsent" : "Message deleted for you", payload);
});

export const reportGroupMessage = asyncHandler(async (req, res) => {
  const message = await GroupMessage.findById(req.params.messageId).lean();
  if (!message) throw new ApiError(404, "Message not found");
  await getGroup(message.group, req.user._id);
  if (String(message.sender) === String(req.user._id)) throw new ApiError(400, "You cannot report your own message");
  const reason = String(req.body.reason || "").toUpperCase();
  if (!["SPAM", "HARASSMENT", "HATE", "SEXUAL_CONTENT", "VIOLENCE", "SCAM", "OTHER"].includes(reason)) throw new ApiError(400, "Select a valid report reason");
  try {
    const report = await MessageReport.create({ reporter: req.user._id, reportedUser: message.sender, scope: "GROUP_MESSAGE", groupMessage: message._id, reason, details: String(req.body.details || "").slice(0, 1000), snapshot: { groupId: String(message.group), messageId: String(message._id), senderId: String(message.sender), body: message.body, createdAt: message.createdAt } });
    return sendResponse(res, 201, "Report received", { reportId: String(report._id), status: report.status });
  } catch (error) { if (error?.code === 11000) throw new ApiError(409, "You already reported this message"); throw error; }
});

export const forwardGroupMessage = asyncHandler(async (req, res) => {
  const source = await GroupMessage.findById(req.params.messageId).lean();
  if (!source) throw new ApiError(404, "Message not found");
  await getGroup(source.group, req.user._id);
  const targets = Array.isArray(req.body.targets) ? req.body.targets.slice(0, 20) : [];
  if (!targets.length) throw new ApiError(400, "Choose at least one conversation");
  for (const target of targets) {
    if (target.type === "group") {
      const group = await getGroup(target.id, req.user._id);
      const message = await GroupMessage.create({ group: group._id, sender: req.user._id, body: source.body, forwardedFrom: source._id, readBy: [{ user: req.user._id }] });
      const payload = { id: String(message._id), groupId: String(group._id), senderId: String(req.user._id), body: message.body, forwarded: true, reactions: [], createdAt: message.createdAt };
      for (const memberId of group.members) req.app.get("io")?.to(`user:${memberId}`).emit("group:message", { groupId: String(group._id), message: payload });
      continue;
    }
    if (!mongoose.isValidObjectId(target.id) || String(target.id) === String(req.user._id)) throw new ApiError(400, "Invalid forwarding account");
    const other = await User.findOne({ _id: target.id, status: "active" }).select("_id name username avatar role isVerified");
    if (!other) throw new ApiError(404, "Forwarding account not found");
    const blocked = await UserBlock.exists({ $or: [{ blocker: req.user._id, blocked: other._id }, { blocker: other._id, blocked: req.user._id }] });
    if (blocked) throw new ApiError(403, "Messaging is unavailable");
    const ids = [String(req.user._id), String(other._id)].sort();
    const legacy = req.user.role === "fan" && other.role === "creator" ? { fan: req.user._id, creator: other._id } : req.user.role === "creator" && other.role === "fan" ? { fan: other._id, creator: req.user._id } : { fan: ids[0], creator: ids[1] };
    let conversation = await Conversation.findOne({ $or: [{ participantKey: ids.join(":") }, legacy] });
    if (!conversation) {
      const follows = Boolean(await ProfileRelationship.exists({ actor: req.user._id, target: other._id, type: "FOLLOW" }));
      conversation = await Conversation.create({ ...legacy, participants: [req.user._id, other._id], participantKey: ids.join(":"), status: follows ? "ACTIVE" : "REQUEST", requestRecipient: follows ? null : other._id, requestStartedAt: follows ? null : new Date(), acceptedAt: follows ? new Date() : null });
    }
    if (conversation.status === "DECLINED") throw new ApiError(403, "This message request was declined");
    const message = await Message.create({ sender: req.user._id, recipient: other._id, body: source.body, forwardedFrom: source._id });
    const payload = { id: String(message._id), senderId: String(req.user._id), recipientId: String(other._id), body: message.body, mediaType: "text", forwarded: true, reactions: [], createdAt: message.createdAt };
    req.app.get("io")?.to(`user:${other._id}`).emit("message:new", { message: payload, participant: person(req.user), conversationStatus: conversation.status });
  }
  return sendResponse(res, 201, "Message forwarded", {});
});
