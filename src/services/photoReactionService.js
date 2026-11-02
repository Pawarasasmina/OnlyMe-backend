import mongoose from "mongoose";
import ProfileMedia from "../models/ProfileMedia.js";
import { isStoryReaction, STORY_REACTIONS } from "../constants/storyReactions.js";
import { profileMediaOwnerByUsername } from "./profileMediaService.js";
import ApiError from "../utils/ApiError.js";

const idOf = value => String(value?._id || value?.id || value || "");
export function photoReactionSummary(item, viewerId) {
  const byUser = new Map();
  for (const user of item.likedBy || []) byUser.set(idOf(user), { user, emoji: "❤️" });
  for (const reaction of item.reactions || []) byUser.set(idOf(reaction.user), reaction);
  const rows = [...byUser.values()];
  const counts = {};
  for (const row of rows) counts[row.emoji] = (counts[row.emoji] || 0) + 1;
  const account = row => ({ id: idOf(row.user), name: row.user?.name || row.user?.username || "Member", username: row.user?.username || "", avatar: row.user?.avatar || "", emoji: row.emoji });
  const sorted = [...rows].sort((a, b) => Number(idOf(b.user) === String(viewerId)) - Number(idOf(a.user) === String(viewerId)));
  return { reactionCount: rows.length, reactionBreakdown: counts, viewerReaction: byUser.get(String(viewerId))?.emoji || null, reactionPreview: sorted.filter(row => row.user?.username).slice(0, 2).map(account), reactors: sorted.map(account) };
}

async function photo(username, mediaId) {
  if (!mongoose.isValidObjectId(mediaId)) throw new ApiError(400, "Invalid photo");
  const owner = await profileMediaOwnerByUsername(username);
  const item = await ProfileMedia.findOne({ _id: mediaId, user: owner._id, type: "image" }).populate("reactions.user likedBy", "name username avatar").lean();
  if (!item) throw new ApiError(404, "Photo not found");
  return { item, owner };
}
export async function setPhotoReaction({ username, mediaId, user, reaction }) {
  if (reaction !== null && !isStoryReaction(reaction)) throw new ApiError(400, "Choose a valid reaction");
  const emoji = reaction === null ? null : STORY_REACTIONS.find(value => value.replace(/\uFE0F/g, "") === reaction.replace(/\uFE0F/g, ""));
  const { owner } = await photo(username, mediaId);
  const userId = new mongoose.Types.ObjectId(String(user._id));
  const next = await ProfileMedia.findOneAndUpdate({ _id: mediaId, user: owner._id }, [
    { $set: {
      likedBy: { $filter: { input: { $ifNull: ["$likedBy", []] }, as: "actor", cond: { $ne: ["$$actor", userId] } } },
      reactions: { $concatArrays: [{ $filter: { input: { $ifNull: ["$reactions", []] }, as: "rx", cond: { $ne: ["$$rx.user", userId] } } }, emoji ? [{ user: userId, emoji, createdAt: new Date() }] : []] },
    } },
  ], { new: true }).populate("reactions.user likedBy", "name username avatar").lean();
  if (!next) throw new ApiError(404, "Photo not found");
  const summary = photoReactionSummary(next, user._id);
  delete summary.reactors;
  return summary;
}
export async function listPhotoReactions({ username, mediaId, viewerId }) {
  const { item } = await photo(username, mediaId);
  return photoReactionSummary(item, viewerId);
}
