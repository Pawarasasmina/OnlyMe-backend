import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { addSeenMediaToProfileMedia, addStoryToProfileMedia, createProfileMedia, listOwnProfileMedia, listProfileMediaForUser, profileMediaOwnerByUsername, removeOwnProfileMedia, reportProfileMedia, toggleProfileMediaLike } from "../services/profileMediaService.js";

export const getOwnProfileMedia = asyncHandler(async (req, res) => {
  const media = await listOwnProfileMedia(req.user._id, { limit: req.query.limit });
  return sendResponse(res, 200, "Profile Media fetched", { media });
});

export const getProfileMediaByUsername = asyncHandler(async (req, res) => {
  const owner = await profileMediaOwnerByUsername(req.params.username);
  const media = await listProfileMediaForUser(owner._id, { limit: req.query.limit, viewerId: req.user?._id });
  return sendResponse(res, 200, "Profile Media fetched", { media });
});

export const addOwnProfileMedia = asyncHandler(async (req, res) => {
  const media = await createProfileMedia({ caption: req.body.caption, file: req.file, user: req.user });
  return sendResponse(res, 201, "Profile Media added", { media });
});

export const addOwnProfileMediaFromStory = asyncHandler(async (req, res) => {
  const result = await addStoryToProfileMedia({ storyId: req.body.storyId || req.params.storyId, user: req.user });
  return sendResponse(res, result.skippedDuplicate ? 200 : 201, result.skippedDuplicate ? "This item is already in Profile Media" : "Added to Profile Media", result);
});

export const addOwnProfileMediaFromSeen = asyncHandler(async (req, res) => {
  const result = await addSeenMediaToProfileMedia({ mediaIds: req.body.mediaIds, seenId: req.body.seenId || req.params.seenId, user: req.user });
  return sendResponse(res, result.added.length ? 201 : 200, result.added.length === 1 ? "Added to Profile Media" : `Added ${result.added.length} items to Profile Media`, result);
});

export const deleteOwnProfileMedia = asyncHandler(async (req, res) => {
  const result = await removeOwnProfileMedia({ mediaId: req.params.mediaId, user: req.user });
  return sendResponse(res, 200, "Removed from Profile Media", result);
});

export const likeProfileMediaByUsername = asyncHandler(async (req, res) => {
  const result = await toggleProfileMediaLike({ mediaId: req.params.mediaId, username: req.params.username, user: req.user });
  return sendResponse(res, 200, result.liked ? "Media liked" : "Media like removed", result);
});

export const reportProfileMediaByUsername = asyncHandler(async (req, res) => {
  const result = await reportProfileMedia({ mediaId: req.params.mediaId, payload: req.body, username: req.params.username, user: req.user });
  return sendResponse(res, 201, "Media report received", result);
});
