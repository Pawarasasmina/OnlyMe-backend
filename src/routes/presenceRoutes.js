import { Router } from "express";
import User from "../models/User.js";
import { protect } from "../middleware/authMiddleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { ownPresence, presenceForViewer, touchPresence } from "../services/presenceService.js";
import ApiError from "../utils/ApiError.js";
import { deliverMessages } from "../services/messageDeliveryService.js";

const router = Router();
router.use(protect);
router.get("/", asyncHandler(async (req, res) => sendResponse(res, 200, "Message presence fetched", { items: await presenceForViewer(req.user._id, String(req.query.ids || "").split(",")) })));
router.post("/heartbeat", asyncHandler(async (req, res) => {
  if (typeof req.body.foreground !== "boolean" || typeof req.body.interaction !== "boolean") throw new ApiError(400, "Foreground and interaction must be booleans");
  const user = await touchPresence(req.user._id, req.body);
  if (req.body.foreground) await deliverMessages(req.app.get("io"), req.user._id);
  return sendResponse(res, 200, "Presence updated", ownPresence(user));
}));
router.post("/offer", asyncHandler(async (req, res) => {
  if (typeof req.body.enable !== "boolean") throw new ApiError(400, "Choose whether to enable At seen");
  const now = new Date();
  const update = req.body.enable ? { activeStatus: { isActive: true, presetKey: "at_seen", label: "At seen", emoji: "\uD83D\uDC41", isCustom: false, color: "#9CCBFF", startedAt: now, expiresAt: null }, "presenceState.lastActivityAt": now, "presenceState.offerAtSeen": false, "presenceState.pausedAt": null } : { "presenceState.offerAtSeen": false };
  const user = await User.findOneAndUpdate({ _id: req.user._id, "presenceState.offerAtSeen": true }, { $set: update, $inc: { "presenceState.revision": 1 } }, { new: true }).select("activeStatus +presenceState");
  if (user) req.app.get("io")?.emit("status:updated", { userId: String(user._id), activeStatus: ownPresence(user).activeStatus });
  return sendResponse(res, 200, "Presence choice saved", ownPresence(user || await User.findById(req.user._id).select("activeStatus +presenceState")));
}));
export default router;
