import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

export const getCurrentUser = asyncHandler(async (req, res) => {
  return sendResponse(res, 200, "Current user fetched", {
    user: req.user,
  });
});
