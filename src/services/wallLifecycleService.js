export const DAY_MS = 86400000;
export function wallClosedReason(post, now = Date.now()) {
  if (post.resolvedAt) return "resolved";
  const age = now - new Date(post.publishedAt || post.createdAt || now).getTime();
  if ((post.rightNow || post.postType === "Right Now" || post.context === "Right now") && age >= DAY_MS) return "expired";
  if ((post.postType === "Event" || (!post.postType && post.context === "Events")) && age >= 7 * DAY_MS) return "ended";
  return "";
}
export function wallActiveExpression(now = new Date()) {
  const stamp = { $ifNull: ["$publishedAt", "$createdAt"] };
  return { $and: [
    { $eq: [{ $ifNull: ["$resolvedAt", null] }, null] },
    { $or: [{ $not: [{ $or: [{ $eq: ["$rightNow", true] }, { $eq: ["$postType", "Right Now"] }, { $eq: ["$context", "Right now"] }] }] }, { $gt: [stamp, new Date(now.getTime() - DAY_MS)] }] },
    { $or: [{ $not: [{ $or: [{ $eq: ["$postType", "Event"] }, { $and: [{ $in: [{ $ifNull: ["$postType", ""] }, [""]] }, { $eq: ["$context", "Events"] }] }] }] }, { $gt: [stamp, new Date(now.getTime() - 7 * DAY_MS)] }] },
  ] };
}
