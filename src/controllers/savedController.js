import Publication from "../models/Publication.js";
import SeenEngagement from "../models/SeenEngagement.js";
import WallPost from "../models/WallPost.js";
import WallEngagement from "../models/WallEngagement.js";
import { serializePublication } from "../services/publicationAccessService.js";
import { engagementForWallPost, serializeWallPost } from "./wallController.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

export const listSavedContent = asyncHandler(async (req, res) => {
  const [seenSaves, wallSaves] = await Promise.all([
    SeenEngagement.find({ user: req.user._id, type: "SAVE" }).sort({ createdAt: -1 }).limit(100).select("publication").lean(),
    WallEngagement.find({ user: req.user._id, type: "SAVE" }).sort({ createdAt: -1 }).limit(100).select("post").lean(),
  ]);
  const [seenRecords, wallRecords] = await Promise.all([
    Publication.find({ _id: { $in: seenSaves.map((item) => item.publication) }, kind: "SEEN", status: "PUBLISHED" }).populate("creator", "name username avatar isVerified").lean(),
    WallPost.find({ _id: { $in: wallSaves.map((item) => item.post) }, status: "PUBLISHED" }).populate("creator", "name username avatar isVerified").lean(),
  ]);
  const seenOrder = new Map(seenSaves.map((item, index) => [String(item.publication), index]));
  const wallOrder = new Map(wallSaves.map((item, index) => [String(item.post), index]));
  seenRecords.sort((left, right) => seenOrder.get(String(left._id)) - seenOrder.get(String(right._id)));
  wallRecords.sort((left, right) => wallOrder.get(String(left._id)) - wallOrder.get(String(right._id)));
  const wallPosts = await Promise.all(wallRecords.map(async (post) => serializeWallPost(post, await engagementForWallPost(post._id, req.user._id))));
  return sendResponse(res, 200, "Saved content fetched", { seens: seenRecords.map((item) => serializePublication(item, req.user)).filter(Boolean), wallPosts });
});
