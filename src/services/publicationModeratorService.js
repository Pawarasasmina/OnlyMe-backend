import mongoose from "mongoose";
import Publication from "../models/Publication.js";

export function safeUserProfile(user) {
  if (!user) return null;
  return {
    id: String(user._id || user.id),
    _id: String(user._id || user.id),
    displayName: user.name || user.username || "Atseen user",
    name: user.name || user.username || "Atseen user",
    username: user.username || "",
    avatar: user.avatar || "",
    verified: Boolean(user.isVerified),
  };
}

export async function isExperienceModerator(userId, publicationId) {
  if (!mongoose.isValidObjectId(userId) || !mongoose.isValidObjectId(publicationId)) return false;
  return Boolean(await Publication.exists({
    _id: publicationId,
    kind: { $in: ["WORLD", "PREMIUM_WORLD", "EXPERIENCE"] },
    "worldModerators.user": userId,
  }));
}

export function canModeratePublication(userId, publication) {
  if (!userId || !publication) return false;
  if (String(publication.creator?._id || publication.creator) === String(userId)) return true;
  return (publication.worldModerators || []).some((item) => String(item.user?._id || item.user) === String(userId));
}
