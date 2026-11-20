import mongoose from "mongoose";
import User from "../models/User.js";
import ProfileRelationship from "../models/ProfileRelationship.js";
import UserBlock from "../models/UserBlock.js";
import { serializeProfileStatus } from "./statusService.js";

export const ACTIVE_WINDOW_MS = 2 * 60 * 1000;
export const AT_SEEN_IDLE_MS = 30 * 60 * 1000;
export const AT_SEEN_RESTORE_MS = 3 * 60 * 60 * 1000;
export const isAtSeen = status => status?.presetKey === "at_seen" || String(status?.label || "").replace(/[^a-z]/gi, "").toLowerCase() === "atseen";

export function presenceTransition(user, { foreground = false, interaction = false } = {}, now = new Date()) {
  const state = user.presenceState || {};
  const fields = {};
  let active = Boolean(user.activeStatus?.isActive && isAtSeen(user.activeStatus));
  let pausedAt = state.pausedAt ? new Date(state.pausedAt) : null;
  const last = new Date(state.lastActivityAt || Math.max(new Date(user.activeStatus?.startedAt || 0).getTime(), new Date(user.lastSeenAt || 0).getTime()) || now);
  if (active && now - last >= AT_SEEN_IDLE_MS) {
    pausedAt = new Date(last.getTime() + AT_SEEN_IDLE_MS);
    fields["activeStatus.isActive"] = false;
    fields["presenceState.pausedAt"] = pausedAt;
    active = false;
  }
  if (foreground) fields["presenceState.foregroundAt"] = now;
  if (foreground && interaction) {
    fields["presenceState.lastActivityAt"] = now;
    fields.lastSeenAt = now; // Internal analytics only; removed at every response boundary.
    if (pausedAt && isAtSeen(user.activeStatus) && !active) {
      if (now - pausedAt <= AT_SEEN_RESTORE_MS) {
        fields["activeStatus.isActive"] = true;
        fields["activeStatus.expiresAt"] = null;
        fields["presenceState.offerAtSeen"] = false;
      } else fields["presenceState.offerAtSeen"] = true;
      fields["presenceState.pausedAt"] = null;
    }
  }
  return fields;
}

export function manualPresenceReset(now = new Date()) {
  return { "presenceState.lastActivityAt": now, "presenceState.pausedAt": null, "presenceState.offerAtSeen": false };
}

export async function touchPresence(userId, input, now = new Date()) {
  // Compare-and-set prevents a delayed heartbeat/worker from replacing a manual status.
  for (let attempt = 0; attempt < 3; attempt++) {
    const user = await User.findById(userId).select("activeStatus lastSeenAt +presenceState").lean();
    if (!user) return null;
    const fields = presenceTransition(user, input, now);
    if (!Object.keys(fields).length) return user;
    const updated = await User.findOneAndUpdate({ _id: userId, $expr: { $eq: [{ $ifNull: ["$presenceState.revision", 0] }, user.presenceState?.revision || 0] }, "activeStatus.startedAt": user.activeStatus?.startedAt || null, "activeStatus.isActive": user.activeStatus?.isActive ? true : { $ne: true } }, { $set: fields, $inc: { "presenceState.revision": 1 } }, { new: true }).select("activeStatus +presenceState").lean();
    if (updated) return updated;
  }
  return User.findById(userId).select("activeStatus +presenceState").lean();
}

export async function pauseIdleAtSeen(now = new Date()) {
  const cutoff = new Date(now - AT_SEEN_IDLE_MS);
  const users = await User.find({ "activeStatus.isActive": true, $or: [{ "activeStatus.presetKey": "at_seen" }, { "activeStatus.label": /^[^a-z]*at\s*seen[^a-z]*$/i }], $and: [{ $or: [{ "presenceState.lastActivityAt": { $lte: cutoff } }, { "presenceState.lastActivityAt": { $exists: false } }] }] }).select("_id").limit(500).lean();
  const rows = await Promise.all(users.map(async user => { const updated = await touchPresence(user._id, {}, now); return { userId: String(user._id), ...ownPresence(updated) }; }));
  return rows.filter(row => !row.atSeenActive);
}

export function ownPresence(user) {
  return { activeStatus: serializeProfileStatus(user?.activeStatus), atSeenActive: Boolean(user?.activeStatus?.isActive && isAtSeen(user.activeStatus)), offerAtSeen: Boolean(user?.presenceState?.offerAtSeen) };
}

export async function presenceForViewer(viewerId, ids, now = new Date()) {
  const safeIds = [...new Set(ids.map(String))].filter(id => mongoose.isValidObjectId(id) && id !== String(viewerId)).slice(0, 100);
  const [viewer, users, outgoing, incoming, blocks] = await Promise.all([
    User.findById(viewerId).select("activity_status status").lean(),
    User.find({ _id: { $in: safeIds } }).select("activity_status status +presenceState").lean(),
    ProfileRelationship.find({ actor: viewerId, target: { $in: safeIds }, type: "FOLLOW" }).select("target").lean(),
    ProfileRelationship.find({ target: viewerId, actor: { $in: safeIds }, type: "FOLLOW" }).select("actor").lean(),
    UserBlock.find({ $or: [{ blocker: viewerId, blocked: { $in: safeIds } }, { blocked: viewerId, blocker: { $in: safeIds } }] }).select("blocker blocked").lean(),
  ]);
  const follows = new Set(outgoing.map(row => String(row.target)));
  const followers = new Set(incoming.map(row => String(row.actor)));
  const blocked = new Set(blocks.flatMap(row => [String(row.blocker), String(row.blocked)]));
  const byId = new Map(users.map(user => [String(user._id), user]));
  return safeIds.map(userId => {
    const user = byId.get(userId);
    return { userId, active_now: Boolean(viewer && user && viewer.status === "active" && user.status === "active" && viewer.activity_status !== false && user.activity_status !== false && follows.has(userId) && followers.has(userId) && !blocked.has(userId) && user.presenceState?.foregroundAt && now - new Date(user.presenceState.foregroundAt) < ACTIVE_WINDOW_MS) };
  });
}
