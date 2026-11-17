import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { recordPrivateShare, weeklySeenShareSummary } from "../services/contentShareService.js";

export const recordShare = asyncHandler(async (req, res) => {
  const result = await recordPrivateShare({ user: req.user, contentType: req.body.contentType, contentId: req.body.contentId, route: req.body.route });
  return sendResponse(res, 200, result.counted ? "Share counted" : "Share already counted", result);
});

export const weeklySummary = asyncHandler(async (req, res) => {
  const items = await weeklySeenShareSummary(req.user._id);
  return sendResponse(res, 200, "Weekly share summary fetched", { items });
});
