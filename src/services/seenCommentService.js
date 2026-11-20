import SeenEngagement from "../models/SeenEngagement.js";

export async function removeSeenCommentThread(publication, commentId) {
  const replies = await SeenEngagement.find({ publication, parentComment: commentId, type: "COMMENT" }).select("_id").lean();
  const ids = [commentId, ...replies.map(reply => reply._id)];
  await SeenEngagement.deleteMany({ publication, $or: [{ _id: { $in: ids } }, { type: "COMMENT_REACTION", parentComment: { $in: ids } }] });
}
