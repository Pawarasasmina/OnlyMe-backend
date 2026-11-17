export const publicWallModerationFilter = {
  moderationHiddenAt: null,
  moderationStatus: { $nin: ["PENDING_REVIEW", "REJECTED"] },
};

export function canReadWallNote(post, viewer) {
  const owner = String(post.author?._id || post.author?.id || post.author || "");
  if (viewer?._id && owner === String(viewer._id)) return true;
  if (["admin", "super_admin"].includes(viewer?.role)) return true;
  return post.visibility !== "private" && !post.moderationHiddenAt && !["PENDING_REVIEW", "REJECTED"].includes(post.moderationStatus);
}

export function wallProfileModerationFilter(owner, viewer) {
  return String(owner) === String(viewer?._id || "") ? {} : { visibility: "public", ...publicWallModerationFilter };
}
