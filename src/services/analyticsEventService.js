import mongoose from "mongoose";
import AnalyticsEvent, { ANALYTICS_EVENT_TYPES } from "../models/AnalyticsEvent.js";
import AnalyticsSession from "../models/AnalyticsSession.js";
import CreatorProfile from "../models/CreatorProfile.js";
import FanProfile from "../models/FanProfile.js";
import ProfileRelationship from "../models/ProfileRelationship.js";
import Subscription from "../models/Subscription.js";
import Transaction from "../models/Transaction.js";
import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";

export const TRACKING_START_DATE = new Date("2026-09-03T00:00:00.000Z");
export const SESSION_INACTIVITY_MS = 30 * 60 * 1000;
export const PROFILE_VIEW_DEDUPE_MS = 20 * 60 * 1000;
export const MAX_ANALYTICS_BATCH_SIZE = 50;

const CLIENT_EVENT_TYPES = new Set([
  "PROFILE_VIEW",
  "SEARCH_RESULT_CLICKED",
  "CONTENT_IMPRESSION",
  "CONTENT_VIEW",
  "CONTENT_OPENED",
]);
const SOURCES = new Set(["home", "discover", "search", "profile", "seen", "saved", "notification", "world", "admin", "unknown"]);
const ENTITY_TYPES = new Set(["", "user", "profile", "feed_post", "content", "seen", "world", "story", "publication", "comment", "book", "place", "journey", "search_result"]);

function clean(value, max = 80) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeSource(value) {
  const source = clean(value, 40).toLowerCase().replace(/[^a-z0-9_/-]+/g, "_").slice(0, 40);
  return SOURCES.has(source) ? source : source || "unknown";
}

function normalizeEntityType(value) {
  const entityType = clean(value, 40).toLowerCase();
  if (!ENTITY_TYPES.has(entityType)) throw new ApiError(400, "Unsupported analytics entity type");
  return entityType;
}

function normalizeEventType(value, { client = false } = {}) {
  const eventType = clean(value, 40).toUpperCase();
  if (!ANALYTICS_EVENT_TYPES.includes(eventType)) throw new ApiError(400, "Unsupported analytics event type");
  if (client && !CLIENT_EVENT_TYPES.has(eventType)) throw new ApiError(400, "Analytics event type must be recorded by the server");
  return eventType;
}

export function readAnalyticsSessionId(req) {
  return clean(req.get("X-Analytics-Session-Id") || req.body?.sessionId, 80);
}

function isSensitiveSearch(query) {
  return /@.+\.[a-z]{2,}/iu.test(query) || /\+?\d[\d\s().-]{6,}\d/u.test(query) || /(token|password|secret|bearer)\s+/iu.test(query);
}

function normalizeQuery(value) {
  const query = clean(value, 100);
  return isSensitiveSearch(query) ? "" : query.toLocaleLowerCase();
}

function safeMetadata(eventType, metadata = {}) {
  const input = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
  const output = {};
  if (eventType === "SEARCH_PERFORMED") {
    output.queryLength = Math.max(0, Math.min(100, Number(input.queryLength) || 0));
    output.resultsCount = Math.max(0, Math.min(10000, Number(input.resultsCount) || 0));
    output.searchCategory = clean(input.searchCategory || "all", 40).toLowerCase();
    output.hasResults = Boolean(input.hasResults);
    output.normalizedQuery = normalizeQuery(input.normalizedQuery || input.query);
  } else if (eventType === "SEARCH_RESULT_CLICKED") {
    output.searchEventId = mongoose.isValidObjectId(input.searchEventId) ? String(input.searchEventId) : "";
    output.position = Math.max(0, Math.min(1000, Number(input.position) || 0));
    output.searchCategory = clean(input.searchCategory || "", 40).toLowerCase();
  } else if (eventType === "CONTENT_IMPRESSION") {
    output.placement = clean(input.placement || input.source, 40).toLowerCase();
    output.position = Math.max(0, Math.min(1000, Number(input.position) || 0));
    output.visibleThreshold = Math.max(0, Math.min(1, Number(input.visibleThreshold) || 0.5));
    output.visibleMs = Math.max(0, Math.min(10000, Number(input.visibleMs) || 500));
  } else if (eventType === "PROFILE_VIEW") {
    output.profileUserId = mongoose.isValidObjectId(input.profileUserId) ? String(input.profileUserId) : "";
  } else {
    for (const key of ["placement", "position", "contentType", "targetUserId"]) {
      if (input[key] != null) output[key] = typeof input[key] === "number" ? input[key] : clean(input[key], 80);
    }
  }
  return output;
}

function bucketWindow(date, windowMs) {
  return Math.floor(date.getTime() / windowMs);
}

function dedupeKeyFor({ eventType, userId, sessionId, entityType, entityId, source, metadata, now }) {
  if (eventType === "CONTENT_IMPRESSION") {
    return ["impression", userId, sessionId, entityType, entityId, metadata.placement || source].join(":");
  }
  if (eventType === "PROFILE_VIEW") {
    return ["profile-view", userId, entityId, bucketWindow(now, PROFILE_VIEW_DEDUPE_MS)].join(":");
  }
  if (eventType === "SEARCH_RESULT_CLICKED" && metadata.searchEventId) {
    return ["search-click", userId, metadata.searchEventId, entityType, entityId, metadata.position].join(":");
  }
  return undefined;
}

function deviceTypeFromUserAgent(userAgent = "") {
  const ua = userAgent.toLowerCase();
  if (/ipad|tablet/.test(ua)) return "tablet";
  if (/mobile|iphone|android/.test(ua)) return "mobile";
  if (ua) return "desktop";
  return "unknown";
}

export async function touchAnalyticsSession({ deviceType = "unknown", now = new Date(), sessionId, userId }) {
  if (!sessionId) return null;
  const startedAt = now;
  const existing = await AnalyticsSession.findOne({ sessionId });
  if (!existing) {
    return AnalyticsSession.create({ deviceType, lastActivityAt: now, sessionId, startedAt, userId });
  }
  if (String(existing.userId) !== String(userId)) throw new ApiError(400, "Analytics session does not belong to this user");
  existing.lastActivityAt = now;
  existing.durationSeconds = Math.max(0, Math.round((now.getTime() - existing.startedAt.getTime()) / 1000));
  if (existing.endedAt && existing.endedAt < now) existing.endedAt = null;
  if (deviceType !== "unknown") existing.deviceType = deviceType;
  return existing.save();
}

export async function endAnalyticsSession({ now = new Date(), sessionId, userId }) {
  if (!sessionId) return null;
  const session = await AnalyticsSession.findOne({ sessionId, userId });
  if (!session) return null;
  session.lastActivityAt = now;
  session.endedAt = now;
  session.durationSeconds = Math.max(0, Math.round((now.getTime() - session.startedAt.getTime()) / 1000));
  await session.save();
  return session;
}

export async function recordAnalyticsEvent({ client = false, entityId = "", entityType = "", eventType, metadata = {}, now = new Date(), req = null, sessionId = "", source = "unknown", userId }) {
  if (!userId) throw new ApiError(401, "Analytics requires an authenticated user");
  const type = normalizeEventType(eventType, { client });
  const cleanEntityType = normalizeEntityType(entityType);
  const cleanEntityId = clean(entityId, 80);
  if (cleanEntityId && type !== "SEARCH_RESULT_CLICKED" && !mongoose.isValidObjectId(cleanEntityId) && !["search_result"].includes(cleanEntityType)) throw new ApiError(400, "Invalid analytics entity ID");
  const finalSessionId = clean(sessionId || req && readAnalyticsSessionId(req), 80);
  if (!finalSessionId) throw new ApiError(400, "Analytics session ID is required");
  const finalSource = normalizeSource(source);
  const safe = safeMetadata(type, metadata);
  const deviceType = req ? deviceTypeFromUserAgent(req.get("User-Agent") || "") : "unknown";

  await touchAnalyticsSession({ deviceType, now, sessionId: finalSessionId, userId });
  const dedupeKey = dedupeKeyFor({ entityId: cleanEntityId, entityType: cleanEntityType, eventType: type, metadata: safe, now, sessionId: finalSessionId, source: finalSource, userId });

  try {
    const event = await AnalyticsEvent.create({
      userId,
      sessionId: finalSessionId,
      eventType: type,
      entityType: cleanEntityType,
      entityId: cleanEntityId,
      source: finalSource,
      metadata: safe,
      dedupeKey,
      createdAt: now,
    });
    return { event, recorded: true };
  } catch (error) {
    if (error?.code === 11000 && dedupeKey) {
      const existing = await AnalyticsEvent.findOne({ dedupeKey }).lean();
      return { event: existing, recorded: false };
    }
    throw error;
  }
}

export async function recordAnalyticsBatch({ events = [], req, userId }) {
  if (!Array.isArray(events)) throw new ApiError(400, "Analytics events must be an array");
  if (events.length > MAX_ANALYTICS_BATCH_SIZE) throw new ApiError(400, `Analytics batch cannot exceed ${MAX_ANALYTICS_BATCH_SIZE} events`);
  const results = [];
  for (const event of events) {
    results.push(await recordAnalyticsEvent({ ...event, client: true, req, sessionId: event.sessionId || readAnalyticsSessionId(req), userId }));
  }
  return { accepted: results.length, recorded: results.filter((item) => item.recorded).length };
}

function percent(numerator, denominator) {
  if (!denominator) return null;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

export function retentionPercent(cohortUsers = [], returningUsers = []) {
  const cohort = new Set(cohortUsers.map(String));
  if (!cohort.size) return null;
  const returned = new Set(returningUsers.map(String).filter((id) => cohort.has(id)));
  return percent(returned.size, cohort.size);
}

export async function sessionAnalytics(startDate, endDate) {
  const [sessions, users, avgRow, dauRows, wauRows, mauRows] = await Promise.all([
    AnalyticsSession.countDocuments({ startedAt: { $gte: startDate, $lte: endDate } }),
    AnalyticsSession.distinct("userId", { startedAt: { $gte: startDate, $lte: endDate } }),
    AnalyticsSession.aggregate([{ $match: { startedAt: { $gte: startDate, $lte: endDate } } }, { $group: { _id: null, avg: { $avg: "$durationSeconds" } } }]),
    AnalyticsSession.aggregate([{ $match: { startedAt: { $gte: startDate, $lte: endDate } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$startedAt", timezone: "UTC" } }, users: { $addToSet: "$userId" } } }]),
    AnalyticsSession.aggregate([{ $match: { startedAt: { $gte: startDate, $lte: endDate } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: { $dateTrunc: { date: "$startedAt", unit: "week", timezone: "UTC", startOfWeek: "sun" } }, timezone: "UTC" } }, users: { $addToSet: "$userId" } } }]),
    AnalyticsSession.aggregate([{ $match: { startedAt: { $gte: startDate, $lte: endDate } } }, { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$startedAt", timezone: "UTC" } }, users: { $addToSet: "$userId" } } }]),
  ]);
  const priorUsers = await AnalyticsSession.distinct("userId", { startedAt: { $lt: startDate } });
  const rangeUserSet = new Set(users.map(String));
  const priorUserSet = new Set(priorUsers.map(String));
  return {
    sessions,
    uniqueSessions: sessions,
    activeSessionUsers: users.length,
    averageSessionDurationSeconds: Math.round(avgRow[0]?.avg || 0),
    returningUsers: [...rangeUserSet].filter((id) => priorUserSet.has(id)).length,
    newSessionUsers: [...rangeUserSet].filter((id) => !priorUserSet.has(id)).length,
    dau: dauRows.reduce((max, row) => Math.max(max, row.users.length), 0),
    wau: wauRows.reduce((max, row) => Math.max(max, row.users.length), 0),
    mau: mauRows.reduce((max, row) => Math.max(max, row.users.length), 0),
  };
}

async function retentionForOffset(cohortStart, offsetDays) {
  const cohortEnd = new Date(cohortStart.getTime() + 24 * 60 * 60 * 1000);
  const returnStart = new Date(cohortStart.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  const returnEnd = new Date(returnStart.getTime() + 24 * 60 * 60 * 1000);
  const cohortRows = await AnalyticsSession.aggregate([
    { $group: { _id: "$userId", firstSessionAt: { $min: "$startedAt" } } },
    { $match: { firstSessionAt: { $gte: cohortStart, $lt: cohortEnd } } },
  ]);
  const cohortUsers = cohortRows.map((row) => row._id);
  const returningUsers = await AnalyticsSession.distinct("userId", { startedAt: { $gte: returnStart, $lt: returnEnd } });
  return { cohortSize: cohortUsers.length, retained: retentionPercent(cohortUsers, returningUsers) };
}

export async function retentionAnalytics(endDate = new Date()) {
  const trackedStart = new Date(TRACKING_START_DATE);
  const dayStart = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()));
  const cohorts = [];
  for (let index = 0; index < 12; index += 1) {
    const cohort = new Date(dayStart.getTime() - (index + 1) * 24 * 60 * 60 * 1000);
    if (cohort < trackedStart) break;
    const [d1, d7, d30] = await Promise.all([retentionForOffset(cohort, 1), retentionForOffset(cohort, 7), retentionForOffset(cohort, 30)]);
    cohorts.push({ cohort: cohort.toISOString().slice(0, 10), newUsers: d1.cohortSize, day1: d1.retained, day7: d7.retained, day30: d30.retained });
  }
  const latest = cohorts[0] || { day1: null, day7: null, day30: null };
  return { trackingStartDate: TRACKING_START_DATE, day1: latest.day1, day7: latest.day7, day30: latest.day30, cohorts };
}

export async function profileAnalytics(startDate, endDate) {
  const match = { eventType: "PROFILE_VIEW", createdAt: { $gte: startDate, $lte: endDate } };
  const [total, uniqueRows, trend, profileRows] = await Promise.all([
    AnalyticsEvent.countDocuments(match),
    AnalyticsEvent.aggregate([{ $match: match }, { $group: { _id: "$entityId", visitors: { $addToSet: "$userId" } } }]),
    AnalyticsEvent.aggregate([{ $match: match }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" } }, views: { $sum: 1 }, visitors: { $addToSet: "$userId" } } }, { $project: { _id: 1, views: 1, uniqueVisitors: { $size: "$visitors" } } }, { $sort: { _id: 1 } }]),
    AnalyticsEvent.aggregate([{ $match: match }, { $group: { _id: "$entityId", views: { $sum: 1 }, visitors: { $addToSet: "$userId" } } }, { $project: { views: 1, uniqueVisitors: { $size: "$visitors" } } }, { $sort: { views: -1 } }, { $limit: 10 }]),
  ]);
  const profileIds = profileRows.map((row) => row._id).filter(mongoose.isValidObjectId);
  const [users, followers, creatorProfiles, fanProfiles] = await Promise.all([
    User.find({ _id: { $in: profileIds } }).select("name username role creatorApprovalStatus").lean(),
    ProfileRelationship.aggregate([{ $match: { target: { $in: profileIds.map((id) => new mongoose.Types.ObjectId(id)) }, type: "FOLLOW" } }, { $group: { _id: "$target", count: { $sum: 1 } } }]),
    CreatorProfile.find({ user: { $in: profileIds } }).select("user category").lean(),
    FanProfile.find({ user: { $in: profileIds } }).select("user interests").lean(),
  ]);
  const usersById = new Map(users.map((user) => [String(user._id), user]));
  const followersById = new Map(followers.map((row) => [String(row._id), row.count]));
  const creatorIds = new Set(creatorProfiles.map((profile) => String(profile.user)));
  const fanIds = new Set(fanProfiles.map((profile) => String(profile.user)));
  const mostViewedProfiles = profileRows.map((row) => {
    const user = usersById.get(String(row._id));
    const isCreator = user?.creatorApprovalStatus === "approved" || creatorIds.has(String(row._id));
    return {
      id: row._id,
      profile: user ? { name: user.name, username: user.username } : { name: "Unknown", username: "" },
      accountType: isCreator ? "creator" : fanIds.has(String(row._id)) ? "fan" : user?.role || "unknown",
      views: row.views,
      uniqueVisitors: row.uniqueVisitors,
      followers: followersById.get(String(row._id)) || 0,
      engagement: percent(row.uniqueVisitors, row.views),
    };
  });
  return {
    totalProfileViews: total,
    uniqueProfileVisitors: new Set(uniqueRows.flatMap((row) => row.visitors.map(String))).size,
    creatorProfileViews: mostViewedProfiles.filter((row) => row.accountType === "creator").reduce((sum, row) => sum + row.views, 0),
    fanProfileViews: mostViewedProfiles.filter((row) => row.accountType === "fan").reduce((sum, row) => sum + row.views, 0),
    trend: trend.map((row) => ({ label: row._id, views: row.views, uniqueVisitors: row.uniqueVisitors })),
    mostViewedProfiles,
  };
}

export function funnelRates({ comments = 0, follows = 0, impressions = 0, reactions = 0, saves = 0, shares = 0, subscriptions = 0, support = 0, views = 0 } = {}) {
  const engagements = reactions + comments + saves + shares;
  return {
    impressions,
    views,
    engagements,
    follows,
    subscriptions,
    support,
    viewRate: percent(views, impressions),
    engagementRate: percent(engagements, impressions),
    saveRate: percent(saves, impressions),
    followConversion: percent(follows, views),
    subscriptionConversion: percent(subscriptions + support, views),
  };
}

export async function searchAnalytics(startDate, endDate, previousStartDate, previousEndDate) {
  const match = { eventType: "SEARCH_PERFORMED", createdAt: { $gte: startDate, $lte: endDate } };
  const clickMatch = { eventType: "SEARCH_RESULT_CLICKED", createdAt: { $gte: startDate, $lte: endDate } };
  const previousMatch = { eventType: "SEARCH_PERFORMED", createdAt: { $gte: previousStartDate, $lte: previousEndDate } };
  const [total, users, zero, clicks, trend, categories, terms, previousTerms] = await Promise.all([
    AnalyticsEvent.countDocuments(match),
    AnalyticsEvent.distinct("userId", match),
    AnalyticsEvent.countDocuments({ ...match, "metadata.hasResults": false }),
    AnalyticsEvent.countDocuments(clickMatch),
    AnalyticsEvent.aggregate([{ $match: match }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" } }, searches: { $sum: 1 }, zeroResults: { $sum: { $cond: ["$metadata.hasResults", 0, 1] } } } }, { $sort: { _id: 1 } }]),
    AnalyticsEvent.aggregate([{ $match: match }, { $group: { _id: "$metadata.searchCategory", value: { $sum: 1 } } }, { $sort: { value: -1 } }]),
    AnalyticsEvent.aggregate([{ $match: { ...match, "metadata.normalizedQuery": { $ne: "" } } }, { $group: { _id: "$metadata.normalizedQuery", searches: { $sum: 1 }, zeroResults: { $sum: { $cond: ["$metadata.hasResults", 0, 1] } } } }, { $sort: { searches: -1 } }, { $limit: 20 }]),
    AnalyticsEvent.aggregate([{ $match: { ...previousMatch, "metadata.normalizedQuery": { $ne: "" } } }, { $group: { _id: "$metadata.normalizedQuery", searches: { $sum: 1 } } }]),
  ]);
  const previousByTerm = new Map(previousTerms.map((row) => [row._id, row.searches]));
  const trending = terms.map((row) => {
    const previous = previousByTerm.get(row._id) || 0;
    return { searchTerm: row._id, currentSearches: row.searches, previousSearches: previous, growth: previous ? percent(row.searches - previous, previous) : null, resultClickRate: percent(clicks, total) };
  });
  return {
    totalSearches: total,
    uniqueSearchers: users.length,
    averageSearchesPerUser: users.length ? Number((total / users.length).toFixed(2)) : null,
    zeroResultSearches: zero,
    zeroResultRate: percent(zero, total),
    resultClickThroughRate: percent(clicks, total),
    trend: trend.map((row) => ({ label: row._id, searches: row.searches, zeroResults: row.zeroResults })),
    categoryDistribution: categories.map((row) => ({ label: row._id || "all", value: row.value })),
    topSearches: terms.map((row) => ({ searchTerm: row._id, searches: row.searches, zeroResults: row.zeroResults })),
    zeroResultSearchesList: terms.filter((row) => row.zeroResults > 0).map((row) => ({ searchTerm: row._id, zeroResults: row.zeroResults })),
    trendingSearches: trending.sort((a, b) => (b.growth ?? -Infinity) - (a.growth ?? -Infinity) || b.currentSearches - a.currentSearches).slice(0, 10),
  };
}

export async function contentFunnelAnalytics(startDate, endDate) {
  const eventMatch = { createdAt: { $gte: startDate, $lte: endDate } };
  const [
    impressions, views, reactions, comments, saves, shares, follows, subscriptions, support,
  ] = await Promise.all([
    AnalyticsEvent.countDocuments({ eventType: "CONTENT_IMPRESSION", ...eventMatch }),
    AnalyticsEvent.countDocuments({ eventType: { $in: ["CONTENT_VIEW", "CONTENT_OPENED"] }, ...eventMatch }),
    AnalyticsEvent.countDocuments({ eventType: "REACTION", ...eventMatch }),
    AnalyticsEvent.countDocuments({ eventType: "COMMENT", ...eventMatch }),
    AnalyticsEvent.countDocuments({ eventType: "SAVE", ...eventMatch }),
    AnalyticsEvent.countDocuments({ eventType: "SHARE", ...eventMatch }),
    AnalyticsEvent.countDocuments({ eventType: "FOLLOW", ...eventMatch }),
    Subscription.countDocuments({ createdAt: { $gte: startDate, $lte: endDate } }),
    Transaction.countDocuments({ createdAt: { $gte: startDate, $lte: endDate } }),
  ]);
  return funnelRates({ comments, follows, impressions, reactions, saves, shares, subscriptions, support, views });
}

export async function impressionCountsByContent() {
  const rows = await AnalyticsEvent.aggregate([
    { $match: { eventType: "CONTENT_IMPRESSION" } },
    { $group: { _id: { entityType: "$entityType", entityId: "$entityId" }, impressions: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [`${row._id.entityType}:${row._id.entityId}`, row.impressions]));
}

export const analyticsEventServiceTestUtils = {
  deviceTypeFromUserAgent,
  funnelRates,
  normalizeQuery,
  retentionPercent,
  safeMetadata,
};
