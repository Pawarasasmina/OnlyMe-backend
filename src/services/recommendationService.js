import crypto from "node:crypto";
import AnalyticsEvent from "../models/AnalyticsEvent.js";
import CreatorProfile from "../models/CreatorProfile.js";
import FanProfile from "../models/FanProfile.js";
import ProfileRelationship from "../models/ProfileRelationship.js";
import RecommendationBatch from "../models/RecommendationBatch.js";
import RecommendationConfig from "../models/RecommendationConfig.js";
import UserInterestProfile from "../models/UserInterestProfile.js";
import ApiError from "../utils/ApiError.js";

export const DEFAULT_RECOMMENDATION_CONFIG = Object.freeze({
  mixes: {
    SEEN: { interest: 70, related: 20, discovery: 10 },
    WALL: { interest: 65, related: 25, discovery: 10 },
    DISCOVER: { interest: 60, related: 30, discovery: 10 },
    STORIES: { interest: 75, related: 20, discovery: 5 },
  },
  signals: { follow: 10, save: 8, share: 8, replay: 7, completion: 6, reaction: 4, profileOpen: 3, longWatch: 3, fastSkip: -6, notInterested: -15 },
  rules: { batchSize: 20, candidateLimit: 200, maxPerCreator: 2, minCategoryDiversity: 3, maxConsecutiveCategory: 2, repeatCooldownDays: 14, recentExposureLimit: 100, recencyHalfLifeHours: 72, fastSkipSeconds: 2 },
  coldStart: { onboardingInterest: 12, language: 4, location: 5, trending: 5, quality: 6, recency: 4 },
});

const SURFACES = new Set(["SEEN", "WALL", "DISCOVER", "STORIES"]);
let cachedConfig = null;
let cacheUntil = 0;

const number = (value, fallback, min, max) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

export function validateRecommendationConfig(input = {}) {
  const config = structuredClone(DEFAULT_RECOMMENDATION_CONFIG);
  for (const surface of SURFACES) {
    const mix = input.mixes?.[surface] || config.mixes[surface];
    const next = {
      interest: number(mix.interest, config.mixes[surface].interest, 0, 100),
      related: number(mix.related, config.mixes[surface].related, 0, 100),
      discovery: number(mix.discovery, config.mixes[surface].discovery, 0, 100),
    };
    if (next.interest + next.related + next.discovery !== 100) throw new ApiError(400, `${surface} mix must total 100`);
    config.mixes[surface] = next;
  }
  for (const [key, fallback] of Object.entries(config.signals)) config.signals[key] = number(input.signals?.[key], fallback, -100, 100);
  for (const [key, fallback] of Object.entries(config.coldStart)) config.coldStart[key] = number(input.coldStart?.[key], fallback, 0, 100);
  const ranges = { batchSize: [5, 100], candidateLimit: [20, 1000], maxPerCreator: [1, 20], minCategoryDiversity: [1, 20], maxConsecutiveCategory: [1, 10], repeatCooldownDays: [0, 365], recentExposureLimit: [10, 1000], recencyHalfLifeHours: [1, 2160], fastSkipSeconds: [0.25, 30] };
  for (const [key, fallback] of Object.entries(config.rules)) config.rules[key] = number(input.rules?.[key], fallback, ...ranges[key]);
  return config;
}

export async function getActiveRecommendationConfig({ fresh = false } = {}) {
  if (!fresh && cachedConfig && Date.now() < cacheUntil) return cachedConfig;
  const row = await RecommendationConfig.findOne({ status: "ACTIVE" }).sort({ version: -1 }).lean();
  cachedConfig = { config: validateRecommendationConfig(row?.config), version: row?.version || 1 };
  cacheUntil = Date.now() + 60_000;
  return cachedConfig;
}

export function clearRecommendationConfigCache() { cachedConfig = null; cacheUntil = 0; }

const normalized = (values = []) => [...new Set(values.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))];
const overlap = (a, b) => a.reduce((sum, value) => sum + (b.has(value) ? 1 : 0), 0);
const recency = (date, halfLifeHours) => Math.exp(-Math.max(0, Date.now() - new Date(date || 0).getTime()) / (halfLifeHours * 3_600_000));
const itemId = (item) => String(item?._id || item?.id || item?.user?._id || item?.user?.id || item?.creator?._id || item?.creator?.id || "");

export async function buildViewerSignals(user, config = DEFAULT_RECOMMENDATION_CONFIG) {
  if (!user?._id) return { coldStart: true, creatorScores: new Map(), topics: new Map(), following: new Set(), location: {}, languages: [] };
  const Profile = user.role === "creator" && user.creatorApprovalStatus === "approved" ? CreatorProfile : FanProfile;
  const [profile, follows, events, learnedProfile] = await Promise.all([
    Profile.findOne({ user: user._id }).lean(),
    ProfileRelationship.find({ actor: user._id, type: "FOLLOW" }).select("target").lean(),
    AnalyticsEvent.find({ userId: user._id, createdAt: { $gte: new Date(Date.now() - 180 * 86_400_000) } }).sort({ createdAt: -1 }).limit(3000).lean(),
    UserInterestProfile.findOne({ user: user._id }).lean(),
  ]);
  const seedTopics = normalized([...(profile?.interests || []), ...(profile?.categories || []), profile?.category, ...(profile?.discoverSettings?.topics || []).filter((x) => x.preference === "interested").map((x) => x.label)]);
  const topics = new Map(seedTopics.map((topic) => [topic, config.coldStart.onboardingInterest]));
  const creatorScores = new Map(follows.map((row) => [String(row.target), config.signals.follow]));
  const configuredSignalWeight = { FOLLOW: config.signals.follow, SAVE: config.signals.save, SHARE: config.signals.share, CONTENT_REPLAY: config.signals.replay, CONTENT_COMPLETED: config.signals.completion, REACTION: config.signals.reaction, PROFILE_VIEW: config.signals.profileOpen, CONTENT_WATCH: config.signals.longWatch, FAST_SKIP: config.signals.fastSkip, NOT_INTERESTED: config.signals.notInterested, HIDE: config.signals.notInterested * 2 };
  const learnedScore = (row) => Object.keys(row.signals || {}).length ? Object.entries(row.signals).reduce((sum, [type, count]) => sum + (configuredSignalWeight[type] || 0) * Number(count || 0), 0) : Number(row.score || 0);
  for (const row of learnedProfile?.topicScores || []) topics.set(row.key, (topics.get(row.key) || 0) + learnedScore(row));
  for (const row of learnedProfile?.creatorScores || []) creatorScores.set(row.key, (creatorScores.get(row.key) || 0) + learnedScore(row));
  const eventWeights = configuredSignalWeight;
  for (const event of learnedProfile?.signalCount ? [] : events) {
    const decay = Math.exp(-(Date.now() - new Date(event.createdAt).getTime()) / (45 * 86_400_000));
    const weight = (eventWeights[event.eventType] || 0) * decay;
    const creatorId = event.metadata?.creatorId || event.metadata?.targetUserId || (event.entityType === "profile" || event.entityType === "user" ? event.entityId : "");
    if (creatorId) creatorScores.set(String(creatorId), (creatorScores.get(String(creatorId)) || 0) + weight);
    for (const topic of normalized(event.metadata?.topics || [])) topics.set(topic, (topics.get(topic) || 0) + weight);
  }
  const affinityCreatorIds = [...creatorScores.entries()].filter(([, score]) => score > 0).sort((a, b) => b[1] - a[1]).slice(0, 50).map(([id]) => id);
  const relatedCreatorProfiles = affinityCreatorIds.length ? await CreatorProfile.find({ user: { $in: affinityCreatorIds } }).select("category categories").lean() : [];
  const relatedTopics = new Set(normalized(relatedCreatorProfiles.flatMap((item) => [item.category, ...(item.categories || [])])));
  return { coldStart: Math.max(events.length, Number(learnedProfile?.signalCount || 0)) < 5, creatorScores, topics, relatedTopics, following: new Set(follows.map((row) => String(row.target))), location: { city: profile?.city || "", country: profile?.country || "" }, languages: normalized(profile?.discoverSettings?.languages || [profile?.preferredLanguage]) };
}

export async function recentExposureIds(userId, surface, config) {
  if (!userId) return new Set();
  const since = new Date(Date.now() - config.rules.repeatCooldownDays * 86_400_000);
  const rows = await RecommendationBatch.find({ user: userId, surface, createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(20).select("itemIds").lean();
  return new Set(rows.flatMap((row) => row.itemIds).slice(0, config.rules.recentExposureLimit).map(String));
}

function candidateData(item, surface) {
  const creator = item.creator?.id || item.creator?._id || item.creator || item.user?.id || item.user?._id || item.user;
  const topics = normalized([item.category, item.creator?.category, ...(item.categories || []), ...(item.creator?.categories || []), ...(item.tags || []), ...(item.creator?.tags || []), item.context]);
  const date = item.publishedAt || item.feedCreatedAt || item.createdAt || item.updatedAt;
  const engagement = item.engagement || {};
  const quality = Number(item.qualityScore || 0)
    + Number(item.viewCount || engagement.viewCount || 0)
    + Number(item.reactionCount || engagement.reactionCount || item.supportCount || 0) * 2
    + Number(item.saveCount || engagement.saveCount || 0) * 5
    + Number(item.shareCount || engagement.shareCount || 0) * 4
    + Number(item.commentCount || engagement.commentCount || 0) * 2
    + Number(item.followers || 0);
  const creatorLocation = item.creator?.location;
  const location = String(item.location || (typeof creatorLocation === "string" ? creatorLocation : [creatorLocation?.city, creatorLocation?.country].filter(Boolean).join(" ")) || item.creator?.city || "").toLowerCase();
  const languages = normalized([item.language, ...(item.languages || [])]);
  return { id: itemId(item) || String(creator || ""), creatorId: String(creator || ""), topics, category: topics[0] || "uncategorized", date, quality: Math.log1p(Math.max(0, quality)), location, languages, surface };
}

function seededJitter(seed, id) {
  if (!seed) return 0;
  const digest = crypto.createHash("sha256").update(`${seed}:${id}`).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

export function rankCandidates(items, { config, exposureIds = new Set(), refreshSeed = "", signals, surface }) {
  const mix = config.mixes[surface];
  const topicSet = new Set([...signals.topics.entries()].filter(([, score]) => score > 0).map(([topic]) => topic));
  const scored = items.map((item) => {
    const data = candidateData(item, surface);
    const topicMatches = overlap(data.topics, topicSet);
    const relatedTopicMatches = overlap(data.topics, signals.relatedTopics || new Set());
    const creatorAffinity = signals.creatorScores.get(data.creatorId) || 0;
    const interestScore = topicMatches * 12;
    const relatedScore = creatorAffinity + relatedTopicMatches * 6 + (signals.following.has(data.creatorId) ? 5 : 0);
    const discoveryScore = topicMatches || creatorAffinity > 0 ? 0 : data.quality + 1;
    const locationMatch = [signals.location.city, signals.location.country].filter(Boolean).some((value) => data.location.includes(String(value).toLowerCase()));
    const languageMatch = data.languages.some((value) => signals.languages.includes(value));
    const bucket = interestScore > 0 ? "interest" : relatedScore > 0 ? "related" : "discovery";
    let score = interestScore + relatedScore + discoveryScore + recency(data.date, config.rules.recencyHalfLifeHours) * 8 + data.quality + (locationMatch ? config.coldStart.location : 0) + (languageMatch ? config.coldStart.language : 0);
    if (exposureIds.has(data.id)) score -= 1000;
    // Keep relevance dominant, but rotate candidates with similar scores for each
    // explicit refresh. This also gives a fresh order when the available pool is
    // smaller than the configured repeat-cooldown window.
    score += seededJitter(refreshSeed, data.id) * 3;
    return { data, item, bucket, score };
  });
  const limit = config.rules.batchSize;
  const quotas = { interest: Math.round(limit * mix.interest / 100), related: Math.round(limit * mix.related / 100) };
  quotas.discovery = limit - quotas.interest - quotas.related;
  const selected = [];
  const creatorCounts = new Map();
  const canSelect = (row) => {
    if ((creatorCounts.get(row.data.creatorId) || 0) >= config.rules.maxPerCreator) return false;
    // Missing taxonomy is not a real category and must not cap otherwise
    // unrelated people/content (notably grouped Stories on the Wall).
    if (row.data.category === "uncategorized") return true;
    const recent = selected.slice(-config.rules.maxConsecutiveCategory);
    return recent.length < config.rules.maxConsecutiveCategory || recent.some((item) => item.data.category !== row.data.category);
  };
  const take = (bucket, desired) => {
    const pool = scored.filter((row) => row.bucket === bucket && !selected.includes(row)).sort((a, b) => b.score - a.score);
    for (const row of pool) {
      if (selected.length >= limit || desired <= 0) break;
      if (!canSelect(row)) continue;
      selected.push(row); desired -= 1;
      creatorCounts.set(row.data.creatorId, (creatorCounts.get(row.data.creatorId) || 0) + 1);
    }
  };
  take("interest", quotas.interest); take("related", quotas.related); take("discovery", quotas.discovery);
  for (const row of scored.sort((a, b) => b.score - a.score)) {
    if (selected.length >= limit) break;
    if (selected.includes(row) || !canSelect(row)) continue;
    selected.push(row); creatorCounts.set(row.data.creatorId, (creatorCounts.get(row.data.creatorId) || 0) + 1);
  }
  return selected.map((row) => ({ ...row.item, recommendation: { bucket: row.bucket, reason: row.bucket === "interest" ? "Based on your interests" : row.bucket === "related" ? "Related to creators and topics you like" : "Something new to discover", score: Number(row.score.toFixed(3)) } }));
}

export async function personalizeCandidates({ exposureLimit, items, req, surface }) {
  if (!SURFACES.has(surface) || !req.user?._id) return { items, recommendation: null };
  const { config, version } = await getActiveRecommendationConfig();
  const signals = await buildViewerSignals(req.user, config);
  const exposureIds = await recentExposureIds(req.user._id, surface, config);
  const refreshSeed = String(req.query.refreshToken || crypto.randomUUID()).slice(0, 100);
  const ranked = rankCandidates(items, { config, exposureIds, refreshSeed, signals, surface });
  const exposedItems = Number.isFinite(exposureLimit) ? ranked.slice(0, Math.max(1, exposureLimit)) : ranked;
  const batch = await RecommendationBatch.create({ user: req.user._id, surface, sessionId: String(req.query.sessionId || "").slice(0, 80), configVersion: version, itemIds: exposedItems.map(itemId).filter(Boolean), reasons: Object.fromEntries(exposedItems.map((item) => [itemId(item), item.recommendation?.bucket]).filter(([id]) => id)), expiresAt: new Date(Date.now() + Math.max(1, config.rules.repeatCooldownDays) * 86_400_000) });
  return { items: ranked, recommendation: { batchId: String(batch._id), configVersion: version, mix: config.mixes[surface], coldStart: signals.coldStart, refreshToken: crypto.randomUUID() } };
}
