import {
  buildOrbitForUser,
  getOrbitCities,
  listSentSignals,
  sendSeeYouSignal,
} from "../services/orbitRecommendationService.js";
import { recordChecklistEvent } from "../services/onboardingService.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

export const getOrbit = asyncHandler(async (req, res) => {
  await recordChecklistEvent(req.user._id, "openedOrbit");
  const orbit = await buildOrbitForUser(req.user, {
    limit: req.query.limit,
    city: req.query.city,
    cursor: req.query.cursor,
    sessionId: req.query.sessionId,
  });

  return sendResponse(res, 200, "Orbit fetched", orbit);
});

export const createOrbitSignal = asyncHandler(async (req, res) => {
  const signal = await sendSeeYouSignal({ sender: req.user, targetUserId: req.body.targetUserId });
  return sendResponse(res, 201, "Orbit signal sent", signal);
});

export const getSentOrbitSignals = asyncHandler(async (req, res) => {
  const signals = await listSentSignals(req.user._id);
  return sendResponse(res, 200, "Orbit signals fetched", { signals });
});

export const getOrbitCityProgress = asyncHandler(async (_req, res) => {
  const cities = await getOrbitCities();
  return sendResponse(res, 200, "Orbit city activity fetched", { cities });
});
