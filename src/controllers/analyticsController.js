import rateLimit from "express-rate-limit";
import {
  endAnalyticsSession,
  recordAnalyticsBatch,
  recordAnalyticsEvent,
  readAnalyticsSessionId,
  touchAnalyticsSession,
} from "../services/analyticsEventService.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import { sendResponse } from "../utils/response.js";

export const analyticsRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many analytics events. Please wait a moment and try again." },
});

export const startSession = asyncHandler(async (req, res) => {
  const sessionId = readAnalyticsSessionId(req);
  if (!sessionId) throw new ApiError(400, "Analytics session ID is required");
  const session = await touchAnalyticsSession({ req, sessionId, userId: req.user._id });
  await recordAnalyticsEvent({ eventType: "SESSION_STARTED", req, sessionId, source: req.body.source || "unknown", userId: req.user._id });
  return sendResponse(res, 200, "Analytics session started", { sessionId: session.sessionId, startedAt: session.startedAt });
});

export const endSession = asyncHandler(async (req, res) => {
  const sessionId = readAnalyticsSessionId(req);
  const session = await endAnalyticsSession({ sessionId, userId: req.user._id });
  if (session) {
    await recordAnalyticsEvent({ eventType: "SESSION_ENDED", req, sessionId, source: req.body.source || "unknown", userId: req.user._id });
    await recordAnalyticsEvent({ eventType: "LOGOUT", req, sessionId, source: req.body.source || "unknown", userId: req.user._id });
  }
  return sendResponse(res, 200, "Analytics session ended", { sessionId, ended: Boolean(session) });
});

export const trackEvent = asyncHandler(async (req, res) => {
  const result = await recordAnalyticsEvent({ ...req.body, client: true, req, sessionId: req.body.sessionId || readAnalyticsSessionId(req), userId: req.user._id });
  return sendResponse(res, result.recorded ? 201 : 200, result.recorded ? "Analytics event recorded" : "Analytics event already recorded", { eventId: String(result.event?._id || ""), recorded: result.recorded });
});

export const trackBatch = asyncHandler(async (req, res) => {
  const result = await recordAnalyticsBatch({ events: req.body.events, req, userId: req.user._id });
  return sendResponse(res, 202, "Analytics events accepted", result);
});
