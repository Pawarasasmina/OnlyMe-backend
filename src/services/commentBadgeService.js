import mongoose from "mongoose";
import User from "../models/User.js";
import FanProfile from "../models/FanProfile.js";
import CreatorProfile from "../models/CreatorProfile.js";
import { sendResponse } from "../utils/response.js";

export function visibleMemberBadge(user, profiles = [], viewerId = "") {
  if (!user?._id) return false;
  return String(user._id) === String(viewerId) || !profiles.some(profile => profile?.privacySettings?.showMemberBadge === "only_me");
}

// Enrich only comment identities, never post authors or arbitrary authored text.
export async function attachCommentBadges(data, viewerId) {
  const authors = [];
  const visit = (value, comment = false) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(item => visit(item, comment)); return; }
    if (comment && value.author) authors.push(value.author);
    for (const [key, child] of Object.entries(value)) {
      if (["comments", "replies", "previewComment"].includes(key)) visit(child, true);
      else if (["post", "items", "engagement", "publication"].includes(key)) visit(child);
    }
  };
  visit(data);
  const ids = [...new Set(authors.map(author => String(author.id || author._id || "")).filter(id => mongoose.isValidObjectId(id)))];
  if (!ids.length) return data;
  const [users, fans, creators] = await Promise.all([
    User.find({ _id: { $in: ids }, "activeStatus.isActive": true })
      .select("activeStatus").lean(),
    FanProfile.find({ user: { $in: ids } }).select("user privacySettings.showMemberBadge").lean(),
    CreatorProfile.find({ user: { $in: ids } }).select("user privacySettings.showMemberBadge").lean(),
  ]);
  const badgesByUser = new Map();
  for (const user of users) {
    const emoji = String(user.activeStatus?.emoji || "").trim();
    if (!emoji) continue;
    badgesByUser.set(String(user._id), {
      emoji,
      label: String(user.activeStatus?.label || "").trim(),
      color: String(user.activeStatus?.color || "#9CCBFF"),
    });
  }
  const profiles = new Map();
  for (const profile of [...fans, ...creators]) {
    const id = String(profile.user);
    profiles.set(id, [...(profiles.get(id) || []), profile]);
  }
  for (const author of authors) {
    const id = String(author.id || author._id || "");
    delete author.memberBadge;
    delete author.memberBadges;
    author.statusBadge = visibleMemberBadge({ _id: id }, profiles.get(id), viewerId) ? (badgesByUser.get(id) || null) : null;
  }
  return data;
}

export async function sendCommentResponse(res, status, message, data = {}) {
  await attachCommentBadges(data, res.req?.user?._id);
  return sendResponse(res, status, message, data);
}
