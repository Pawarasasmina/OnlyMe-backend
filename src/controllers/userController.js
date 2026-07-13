import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

export const getCurrentUser = asyncHandler(async (req, res) => {
  return sendResponse(res, 200, "Current user fetched", {
    user: {
      id: req.user._id,
      name: req.user.name,
      username: req.user.username,
      email: req.user.email,
      role: req.user.role,
      avatar: req.user.avatar,
      isVerified: req.user.isVerified,
      status: req.user.status,
      createdAt: req.user.createdAt,
      updatedAt: req.user.updatedAt,
    },
  });
});
