import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { getWallHintDismissals, dismissWallHint } from "../services/wallNeedHintService.js";
import { getWallView, setWallView } from "../services/wallViewPreferenceService.js";

export const getMyWallView = asyncHandler(async (req, res) => sendResponse(res, 200, "Wall view fetched", { view: await getWallView(req.user._id) }));
export const updateMyWallView = asyncHandler(async (req, res) => sendResponse(res, 200, "Wall view saved", { view: await setWallView(req.user._id, req.body.view) }));

export const getMyWallHints = asyncHandler(async (req, res) => sendResponse(res, 200, "Wall hints fetched", { dismissed: await getWallHintDismissals(req.user._id) }));
export const dismissMyWallHint = asyncHandler(async (req, res) => sendResponse(res, 200, "Wall hint dismissed", { dismissed: await dismissWallHint(req.user._id, req.params.hintId) }));

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
