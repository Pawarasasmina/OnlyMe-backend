import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

export const listContent = asyncHandler(async (_req, res) => {
  return sendResponse(res, 200, "Content placeholder list fetched", {
    items: [],
  });
});
