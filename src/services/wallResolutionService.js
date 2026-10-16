const REQUEST_TYPES = ["Looking for", "Offering", "Need Help", "Question", "Recommendation"];
const REQUEST_CONTEXTS = ["Looking for", "Buy/Sell", "Need help", "Advice", "Recommendation", "Shopping"];

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
