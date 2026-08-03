import Publication from "../models/Publication.js";
import FeedPost from "../models/FeedPost.js";
import SeenEngagement from "../models/SeenEngagement.js";
import WallPost from "../models/WallPost.js";
import WallEngagement from "../models/WallEngagement.js";
import WallShareEngagement from "../models/WallShareEngagement.js";
import { serializePublication } from "../services/publicationAccessService.js";
import { engagementForWallPost, engagementForWallShare, serializeWallPost } from "./wallController.js";
import { serializePost } from "./postController.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

export const listSavedContent = asyncHandler(async (req, res) => {
  const [seenSaves, wallSaves, wallShareSaves] = await Promise.all([
    SeenEngagement.find({ user: req.user._id, type: "SAVE" }).sort({ createdAt: -1 }).limit(100).select("publication").lean(),
    WallEngagement.find({ user: req.user._id, type: "SAVE" }).sort({ createdAt: -1 }).limit(100).select("post").lean(),
    WallShareEngagement.find({ user: req.user._id, type: "SAVE" }).sort({ createdAt: -1 }).limit(100).populate({ path: "share", match: { type: "SHARE" }, populate: [{ path: "post", match: { status: "PUBLISHED" }, populate: { path: "creator", select: "name username avatar isVerified" } }, { path: "user", select: "name username avatar isVerified" }] }).lean(),
  ]);
  const [seenRecords, wallRecords, feedRecords] = await Promise.all([
    Publication.find({ _id: { $in: seenSaves.map((item) => item.publication) }, kind: "SEEN", status: "PUBLISHED" }).populate("creator", "name username avatar isVerified").lean(),
    WallPost.find({ _id: { $in: wallSaves.map((item) => item.post) }, status: "PUBLISHED" }).populate("creator", "name username avatar isVerified").lean(),
    FeedPost.find({ status: "published", deletedAt: null, "saves.user": req.user._id })
      .sort({ updatedAt: -1 })
      .limit(100)
      .populate([
        { path: "author", select: "name username avatar isVerified" },
        { path: "comments.user", select: "name username avatar isVerified" },
      ])
      .lean(),
  ]);
  const seenOrder = new Map(seenSaves.map((item, index) => [String(item.publication), index]));
  const wallOrder = new Map(wallSaves.map((item, index) => [String(item.post), index]));
  seenRecords.sort((left, right) => seenOrder.get(String(left._id)) - seenOrder.get(String(right._id)));
  wallRecords.sort((left, right) => wallOrder.get(String(left._id)) - wallOrder.get(String(right._id)));
  const wallPosts = await Promise.all(wallRecords.map(async (post) => serializeWallPost(post, await engagementForWallPost(post._id, req.user._id))));
  const savedShares = await Promise.all(wallShareSaves.filter((save) => save.share?.post && save.share?.user).map(async (save) => { const share = save.share; const originalEngagement = await engagementForWallPost(share.post._id, req.user._id); return serializeWallPost(share.post, { ...(await engagementForWallShare(share._id, req.user._id)), shareCount: originalEngagement.shareCount, viewerShared: originalEngagement.viewerShared }, { feedId: `share-${share._id}`, shareId: share._id, feedCreatedAt: share.createdAt, shareCaption: share.text || "", sharedBy: { id: share.user._id, name: share.user.name, username: share.user.username, avatar: share.user.avatar || "", verified: Boolean(share.user.isVerified) } }); }));
  const feedPosts = feedRecords.map((post) => serializePost(post, req.user));
  return sendResponse(res, 200, "Saved content fetched", { seens: seenRecords.map((item) => serializePublication(item, req.user)).filter(Boolean), wallPosts: [...feedPosts, ...savedShares, ...wallPosts] });
});
