import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

export const getAdminDashboard = asyncHandler(async (_req, res) => {
  return sendResponse(res, 200, "Admin dashboard placeholder", {
    stats: [],
  });
});
