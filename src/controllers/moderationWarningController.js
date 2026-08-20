import Notification from "../models/Notification.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

const serialize = (warning) => ({
  id: String(warning._id),
  title: warning.title,
  message: warning.message,
  severity: warning.severity,
  priority: warning.priority,
  acknowledgedAt: warning.acknowledgedAt,
  createdAt: warning.createdAt,
});

export const listMyPendingWarnings = asyncHandler(async (req, res) => {
  const warnings = await Notification.find({ user: req.user._id, type: "moderation_warning", acknowledgedAt: null }).sort({ priority: -1, createdAt: -1 }).lean();
  return sendResponse(res, 200, "Pending moderation warnings fetched", { warnings: warnings.map(serialize) });
});

export const acknowledgeMyWarning = asyncHandler(async (req, res) => {
  const warning = await Notification.findOneAndUpdate(
    { _id: req.params.warningId, user: req.user._id, type: "moderation_warning" },
    { $set: { acknowledgedAt: new Date(), readAt: new Date() } },
    { new: true },
  );
  if (!warning) throw new ApiError(404, "Moderation warning not found");
  return sendResponse(res, 200, "Moderation warning acknowledged", { warning: serialize(warning) });
});
