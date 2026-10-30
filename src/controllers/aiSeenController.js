import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { getAiSeenStatus, linkAiSeenPublication, startAiSeen, useAiSeenTry } from "../services/aiSeenService.js";

export const status = asyncHandler(async (req, res) => sendResponse(res, 200, "AI Seen allowance fetched", await getAiSeenStatus(req.user)));
export const start = asyncHandler(async (req, res) => sendResponse(res, 201, "AI Seen started", await startAiSeen(req.user)));
export const generate = asyncHandler(async (req, res) => sendResponse(res, 200, "Chapter prepared from your words", await useAiSeenTry(req.user, req.params.sessionId, req.body.answer, { sayAgain: Boolean(req.body.sayAgain) })));
export const linkPublication = asyncHandler(async (req, res) => sendResponse(res, 200, "AI Seen linked", { publication: await linkAiSeenPublication(req.user, req.params.sessionId, req.body.publicationId) }));
