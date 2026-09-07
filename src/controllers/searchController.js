import rateLimit from "express-rate-limit";
import {
  clearRecentSearches,
  getRecentSearches,
  getSearchDefaults,
  getTrendingSearches,
  readSearchParams,
  removeRecentSearch,
  runSearch,
  searchSuggestions,
} from "../services/searchService.js";
import { recordAnalyticsEvent, readAnalyticsSessionId } from "../services/analyticsEventService.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

export const searchRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 45,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many searches. Please wait a moment and try again.",
  },
});

export const search = asyncHandler(async (req, res) => {
  const params = readSearchParams(req.query);
  const data = await runSearch(req.user, params);
  const resultsCount = data.sections
    ? Object.values(data.sections).reduce((sum, section) => sum + Number(section?.total || 0), 0)
    : Number(data.total || 0);
  const sessionId = readAnalyticsSessionId(req);
  if (sessionId) {
    await recordAnalyticsEvent({
      eventType: "SEARCH_PERFORMED",
      metadata: {
        queryLength: params.q.length,
        resultsCount,
        searchCategory: params.type,
        hasResults: resultsCount > 0,
        normalizedQuery: params.q,
      },
      req,
      sessionId,
      source: "search",
      userId: req.user._id,
    });
  }
  return sendResponse(res, 200, "Search completed", data);
});

export const suggestions = asyncHandler(async (req, res) => {
  const data = await searchSuggestions({ q: req.query.q, user: req.user });
  return sendResponse(res, 200, "Search suggestions fetched", data);
});

export const defaults = asyncHandler(async (req, res) => {
  const data = await getSearchDefaults(req.user);
  return sendResponse(res, 200, "Search defaults fetched", data);
});

export const recent = asyncHandler(async (req, res) => {
  return sendResponse(res, 200, "Recent searches fetched", { recent: await getRecentSearches(req.user._id, req.query.limit) });
});

export const removeRecent = asyncHandler(async (req, res) => {
  await removeRecentSearch({ id: req.params.id, userId: req.user._id });
  return sendResponse(res, 200, "Recent search removed");
});

export const clearRecent = asyncHandler(async (req, res) => {
  await clearRecentSearches(req.user._id);
  return sendResponse(res, 200, "Recent searches cleared");
});

export const trending = asyncHandler(async (req, res) => {
  return sendResponse(res, 200, "Trending searches fetched", { trending: await getTrendingSearches({ limit: req.query.limit }) });
});
