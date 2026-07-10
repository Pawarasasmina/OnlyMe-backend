import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

export const getCreatorDashboard = asyncHandler(async (_req, res) => {
  return sendResponse(res, 200, "Creator dashboard placeholder", {
    metrics: [],
  });
});
