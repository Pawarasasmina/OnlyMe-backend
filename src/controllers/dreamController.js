import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { activeDreamGifts, changeDreamStatus, publicDream, saveDream, sendDreamGift } from "../services/dreamService.js";

export const getDream = asyncHandler(async (req, res) => sendResponse(res, 200, "Dream fetched", { dream: await publicDream(req.params.username), gifts: await activeDreamGifts() }));
export const upsertMine = asyncHandler(async (req, res) => sendResponse(res, 200, "Dream saved", { dream: await saveDream(req.user._id, req.body) }));
export const completeMine = asyncHandler(async (req, res) => sendResponse(res, 200, "Dream completed", { dream: await changeDreamStatus(req.user._id, req.params.id, "COMPLETED", req.body.version) }));
export const removeMine = asyncHandler(async (req, res) => sendResponse(res, 200, "Dream removed", { dream: await changeDreamStatus(req.user._id, req.params.id, "REMOVED", req.body.version) }));
export const giftDream = asyncHandler(async (req, res) => sendResponse(res, 201, "Dream gift sent", await sendDreamGift({ user: req.user, dreamId: req.params.id, giftKey: req.body.giftKey, privateSupport: req.body.privateSupport, key: req.body.idempotencyKey })));
