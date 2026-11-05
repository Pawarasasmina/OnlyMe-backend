const REQUEST_TYPES = ["Buy & Sell", "Looking for", "Offering", "Need Help", "Question", "Recommendation", "Event", "Right Now", "Meet people"];
const REQUEST_CONTEXTS = ["Looking for", "Buy/Sell", "Need help", "Advice", "Recommendation", "Shopping", "Events", "Right now", "Meet people"];

export const WALL_AVAILABILITY_DAYS = 14;
export function isAvailabilityNote(post) {
  return ["Buy & Sell", "Offering"].includes(post.postType) || (!post.postType && ["Buy/Sell", "Shopping"].includes(post.context));
}

export function needsAvailabilityConfirmation(post, now = Date.now()) {
  const stamp = new Date(post.bumpedAt || post.publishedAt || post.createdAt).getTime();
  return isAvailabilityNote(post) && !post.resolvedAt && Number.isFinite(stamp) && now - stamp >= WALL_AVAILABILITY_DAYS * 86400000;
}

export function isRequestWallPost(post) {
  return post.postType ? REQUEST_TYPES.includes(post.postType) : REQUEST_CONTEXTS.includes(post.context);
}

export function wallResolutionTarget(id, author) {
  return {
    _id: id,
    author,
    status: "published",
    deletedAt: null,
    $or: [
      { postType: { $in: REQUEST_TYPES } },
      { $and: [{ $or: [{ postType: "" }, { postType: { $exists: false } }] }, { context: { $in: REQUEST_CONTEXTS } }] },
      // Keep reopening possible if an already solved post's category was edited.
      { resolvedAt: { $type: "date" } },
    ],
  };
}
