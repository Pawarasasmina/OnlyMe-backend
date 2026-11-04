import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { setPhotoReaction, listPhotoReactions } from "../services/photoReactionService.js";
export const reactToPhoto = asyncHandler(async (req, res) => sendResponse(res, 200, "Photo reaction updated", await setPhotoReaction({ username: req.params.username, mediaId: req.params.mediaId, user: req.user, reaction: req.body.reaction })));
export const getPhotoReactions = asyncHandler(async (req, res) => sendResponse(res, 200, "Photo reactions fetched", await listPhotoReactions({ username: req.params.username, mediaId: req.params.mediaId, viewerId: req.user?._id })));
