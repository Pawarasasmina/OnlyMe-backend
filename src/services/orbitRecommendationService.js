import mongoose from "mongoose";
import CreatorProfile from "../models/CreatorProfile.js";
import DailyEncounter from "../models/DailyEncounter.js";
import FanProfile from "../models/FanProfile.js";
import Notification from "../models/Notification.js";
import Content from "../models/Content.js";
import OrbitCityProgress from "../models/OrbitCityProgress.js";
import OrbitDream from "../models/OrbitDream.js";
import OrbitSignal from "../models/OrbitSignal.js";
import User from "../models/User.js";
import UserBlock from "../models/UserBlock.js";
import ApiError from "../utils/ApiError.js";

const MAX_LIMIT = 24;
const DEFAULT_LIMIT = 12;
const SESSION_WINDOW = 1000 * 60 * 30;

function cleanText(value, maxLength = 120) {
  return String(value || "").replace(/[<>]/g, "").trim().slice(0, maxLength);
}

function normalizeList(values = []) {
  return [...new Set(values.map((value) => cleanText(value, 40).toLowerCase()).filter(Boolean))];
}

function displayList(values = []) {
  return [...new Set(values.map((value) => cleanText(value, 40)).filter(Boolean))];
}

function sameText(left, right) {
  return cleanText(left).toLowerCase() === cleanText(right).toLowerCase();
}

function profileLocation(profile) {
  return [profile?.city, profile?.country].map((part) => cleanText(part, 80)).filter(Boolean).join(", ");
}

function viewerInterestsFor(user, profile) {
  if (user.role === "creator") {
    return normalizeList([...(profile?.categories || []), profile?.category]);
  }

  return normalizeList(profile?.interests || []);
}

function candidateInterestsFor(profile) {
  return normalizeList([...(profile?.categories || []), profile?.category]);
}

function titleCase(value) {
  return cleanText(value, 40).split(" ").map((item) => item ? item[0].toUpperCase() + item.slice(1).toLowerCase() : "").join(" ");
}

function reasonForCandidate({ candidateInterests, candidateProfile, matchingContentCategory, sharedInterests, viewerCity, viewerCountry }) {
  if (
    cleanText(candidateProfile.orbitStatus).toLowerCase().includes("tennis")
    && candidateInterests.includes("tennis")
    && sharedInterests.includes("tennis")
  ) {
    return { code: "STATUS_INTEREST_MATCH", text: "He needs a partner. You play." };
  }

  if (matchingContentCategory) {
    return { code: "RELEVANT_WORLD", text: `Their ${titleCase(matchingContentCategory)} World matches your interests` };
  }

  if (sharedInterests.length > 1) {
    const label = sharedInterests.slice(0, 2).map(titleCase).join(" and ");
    return { code: "SHARED_INTERESTS", text: `You share ${label} interests` };
  }

  if (sharedInterests.length === 1) {
    return { code: "SHARED_INTEREST", text: `You both follow ${titleCase(sharedInterests[0])}` };
  }

  if (viewerCity && candidateProfile.city && sameText(viewerCity, candidateProfile.city)) {
    return { code: "SAME_CITY", text: `Both active in ${cleanText(candidateProfile.city, 80)}` };
  }

  if (viewerCountry && candidateProfile.country && sameText(viewerCountry, candidateProfile.country)) {
    return { code: "SAME_COUNTRY", text: `Both active in ${cleanText(candidateProfile.country, 80)}` };
  }

  if (candidateInterests.length) {
    const label = candidateInterests[0][0].toUpperCase() + candidateInterests[0].slice(1);
    return { code: "RELEVANT_WORLD", text: `Their work is close to ${label}` };
  }

  return { code: "RELEVANT_CREATOR", text: "Recommended for your Orbit" };
}

function scoreCandidate({ candidateInterests, candidateProfile, sharedInterests, signalSent, viewerCity, viewerCountry }) {
  let score = 0;
  score += sharedInterests.length * 15;
  if (viewerCity && candidateProfile.city && sameText(viewerCity, candidateProfile.city)) score += 30;
  if (viewerCountry && candidateProfile.country && sameText(viewerCountry, candidateProfile.country)) score += 10;
  if (candidateProfile.relevantContentCount) score += 10;
  if (candidateProfile.user?.isVerified) score += 3;
  if (candidateInterests.length) score += 3;
  if (signalSent) score -= 3;
  return score;
}

function serializeCurrentUser(user, profile) {
  const city = cleanText(profile?.city, 80);
  const country = cleanText(profile?.country, 80);
  const interests = user.role === "creator"
    ? displayList([...(profile?.categories || []), profile?.category])
    : displayList(profile?.interests || []);

  return {
    id: String(user._id),
    name: user.name,
    username: user.username,
    avatar: user.avatar || "",
    verified: Boolean(user.isVerified),
    role: user.role,
    status: cleanText(profile?.orbitStatus, 80),
    location: [city, country].filter(Boolean).join(", "),
    city,
    country,
    locationDetails: { city, country },
    interests,
  };
}

function serializeRecommendation({ candidateProfile, hasSeenSignal, reason, score, sharedInterests }) {
  const user = candidateProfile.user;
  const interests = displayList([...(candidateProfile.categories || []), candidateProfile.category]);
  const primaryInterest = sharedInterests[0] || interests[0] || "";
  const location = {
    city: cleanText(candidateProfile.city, 80),
    country: cleanText(candidateProfile.country, 80),
  };
  const worlds = (candidateProfile.worlds || []).slice(0, 3).map((item) => ({
    id: String(item._id),
    title: item.title,
    category: item.category,
    badge: worldBadgeFor(item.category),
  }));

  return {
    id: String(user._id),
    name: user.name,
    username: user.username,
    avatar: user.avatar || "",
    verified: Boolean(user.isVerified),
    role: user.role,
    status: cleanText(candidateProfile.orbitStatus || candidateProfile.category || interests[0] || "", 80),
    location,
    locationLabel: profileLocation(candidateProfile),
    city: location.city,
    country: location.country,
    bio: cleanText(candidateProfile.bio, 220),
    quote: cleanText(candidateProfile.orbitQuote, 240),
    happeningNow: cleanText(candidateProfile.orbitStatus || candidateProfile.category || interests[0] || "", 100),
    sharedInterests: sharedInterests.map((item) => item[0].toUpperCase() + item.slice(1)),
    interests,
    reason: reason.text,
    reasonDetails: {
      code: reason.code,
      label: reason.label || "WHY YOU TWO",
      detail: reason.text,
    },
    reasonCode: reason.code,
    resonanceTier: resonanceTierFor(score),
    worldBadge: primaryInterest
      ? { label: primaryInterest[0].toUpperCase() + primaryInterest.slice(1) }
      : null,
    worldBadges: worlds.map((world) => world.badge).filter(Boolean),
    worlds,
    sharedWorld: null,
    dream: candidateProfile.dream || null,
    hasSeenSignal,
    hasMutualSignal: Boolean(candidateProfile.hasMutualSignal),
    canMessage: Boolean(candidateProfile.messagingEnabled),
    messageAllowed: Boolean(candidateProfile.messagingEnabled),
    directAccess: Boolean(candidateProfile.ppmEnabled),
    profileRoute: `/profile/${encodeURIComponent(user.username)}`,
  };
}

function parseLimit(value) {
  const limit = Number(value) || DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function resonanceTierFor(score) {
  if (score >= 55) return "close";
  if (score >= 30) return "aligned";
  return "discover";
}

function worldBadgeFor(category) {
  const normalized = cleanText(category, 40).toLowerCase();
  const emoji = {
    books: "📚",
    business: "💼",
    fitness: "💪",
    lifestyle: "✦",
    tennis: "🎾",
    travel: "🌍",
  }[normalized] || "🪐";
  return category ? { emoji, label: titleCase(category) } : null;
}

function sessionIdFor(userId, date = new Date()) {
  const slot = Math.floor(date.getTime() / SESSION_WINDOW);
  return `${String(userId)}:${slot}`;
}

function rotateBatch(items, cursor = 0) {
  if (!items.length) return items;
  const offset = Math.max(0, Number(cursor) || 0) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

async function getRoleProfile(user) {
  if (user.role === "creator") {
    return CreatorProfile.findOneAndUpdate(
      { user: user._id },
      { $setOnInsert: { user: user._id } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
  }

  return FanProfile.findOneAndUpdate(
    { user: user._id },
    { $setOnInsert: { user: user._id } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
}

async function blockedUserIds(userId) {
  const blocks = await UserBlock.find({
    $or: [{ blocker: userId }, { blocked: userId }],
  }).lean();

  return new Set(
    blocks.map((block) => String(block.blocker) === String(userId) ? String(block.blocked) : String(block.blocker))
  );
}

async function activeSignalTargetIds(userId) {
  const signals = await OrbitSignal.find({ sender: userId, type: "SEE_YOU", status: "active" }).select("targetUser").lean();
  return new Set(signals.map((signal) => String(signal.targetUser)));
}

async function reciprocalSignalSenderIds(userId) {
  const signals = await OrbitSignal.find({ targetUser: userId, type: "SEE_YOU", status: "active" }).select("sender").lean();
  return new Set(signals.map((signal) => String(signal.sender)));
}

async function getEligibleCreatorProfiles(userId, blockedIds) {
  return CreatorProfile.find({ profileVisibility: "public", "privacySettings.allowDiscovery": { $ne: false } })
    .populate({
      path: "user",
      match: {
        _id: { $nin: [userId, ...Array.from(blockedIds).map((id) => new mongoose.Types.ObjectId(id))] },
        role: "creator",
        status: "active",
        creatorApprovalStatus: "approved",
      },
      select: "name username avatar isVerified role status creatorApprovalStatus createdAt updatedAt",
    })
    .lean();
}

async function publishedContentByCreator(candidateProfiles) {
  if (!candidateProfiles.length) return new Map();
  const creatorIds = candidateProfiles.map((profile) => profile.user?._id).filter(Boolean);
  const items = await Content.find({
    creator: { $in: creatorIds },
    status: { $in: ["PUBLISHED", "published"] },
  }).select("creator title category").sort({ publishedAt: -1, createdAt: -1 }).lean();
  const result = new Map();
  for (const item of items) {
    const creatorId = String(item.creator);
    if (!result.has(creatorId)) result.set(creatorId, []);
    result.get(creatorId).push(item);
  }
  return result;
}

async function publicDreamByCreator(candidateProfiles) {
  if (!candidateProfiles.length) return new Map();
  const creatorIds = candidateProfiles.map((profile) => profile.user?._id).filter(Boolean);
  const dreams = await OrbitDream.find({
    user: { $in: creatorIds },
    visibility: "public",
    status: { $in: ["active", "completed"] },
  }).sort({ status: 1, updatedAt: -1 }).lean();
  const result = new Map();

  for (const dream of dreams) {
    const creatorId = String(dream.user);
    if (result.has(creatorId)) continue;
    result.set(creatorId, {
      id: String(dream._id),
      title: cleanText(dream.title, 120),
      emoji: cleanText(dream.emoji, 8) || "✦",
      status: dream.status,
      currentAmount: dream.currentAmount,
      goalAmount: dream.goalAmount,
      supporterCount: dream.supporterCount,
    });
  }

  return result;
}

export async function buildOrbitForUser(user, options = {}) {
  if (!["fan", "creator"].includes(user.role)) {
    throw new ApiError(403, "Orbit is available to fans and creators");
  }

  const limit = parseLimit(options.limit);
  const cursor = Math.max(0, Number(options.cursor) || 0);
  const viewerProfile = await getRoleProfile(user);
  const [blockedIds, signalTargetIds, reciprocalTargetIds] = await Promise.all([
    blockedUserIds(user._id),
    activeSignalTargetIds(user._id),
    reciprocalSignalSenderIds(user._id),
  ]);
  const candidateProfiles = (await getEligibleCreatorProfiles(user._id, blockedIds)).filter((profile) => profile.user);
  const viewerInterests = viewerInterestsFor(user, viewerProfile);
  const viewerCity = cleanText(options.city || viewerProfile?.city, 80);
  const viewerCountry = cleanText(viewerProfile?.country, 80);
  const [contentByCreator, dreamByCreator] = await Promise.all([
    publishedContentByCreator(candidateProfiles),
    publicDreamByCreator(candidateProfiles),
  ]);

  const scoredRecommendations = candidateProfiles
    .map((candidateProfile) => {
      const candidateInterests = candidateInterestsFor(candidateProfile);
      const sharedInterests = candidateInterests.filter((interest) => viewerInterests.includes(interest));
      const hasSeenSignal = signalTargetIds.has(String(candidateProfile.user._id));
      const contentMatches = contentByCreator.get(String(candidateProfile.user._id)) || [];
      const matchingContent = contentMatches.find((item) => viewerInterests.includes(cleanText(item.category).toLowerCase()));
      const matchingContentCategory = matchingContent?.category || "";
      const scoredProfile = {
        ...candidateProfile,
        hasMutualSignal: hasSeenSignal && reciprocalTargetIds.has(String(candidateProfile.user._id)),
        relevantContentCount: contentMatches.filter((item) => viewerInterests.includes(cleanText(item.category).toLowerCase())).length,
        worlds: contentMatches,
        dream: dreamByCreator.get(String(candidateProfile.user._id)) || null,
      };
      const reason = reasonForCandidate({ candidateInterests, candidateProfile: scoredProfile, matchingContentCategory, sharedInterests, viewerCity, viewerCountry });
      const score = scoreCandidate({ candidateInterests, candidateProfile: scoredProfile, sharedInterests, signalSent: hasSeenSignal, viewerCity, viewerCountry });
      return {
        recommendation: serializeRecommendation({ candidateProfile: scoredProfile, hasSeenSignal, reason, score, sharedInterests }),
        score,
      };
    })
    .sort((left, right) => right.score - left.score || left.recommendation.name.localeCompare(right.recommendation.name));

  const recommendations = scoredRecommendations.map((item) => item.recommendation);
  const todayEncounter = await getTodayEncounter(user, recommendations);
  const visibleRecommendations = rotateBatch(recommendations, cursor).slice(0, limit);
  const nextCursor = recommendations.length > 1 ? String((cursor + Math.min(limit, recommendations.length - 1)) % recommendations.length) : null;


  return {
    currentUser: serializeCurrentUser(user, viewerProfile),
    recommendations: visibleRecommendations,
    todayEncounter,
    nextCursor,
    sessionId: options.sessionId || sessionIdFor(user._id),
    pagination: { cursor, limit, hasMore: recommendations.length > limit, canRefresh: recommendations.length > 1 },
  };
}

export async function getTodayEncounter(user, recommendations, date = new Date()) {
  const encounterDate = todayKey(date);
  const existing = await DailyEncounter.findOne({ user: user._id, encounterDate }).lean();

  if (existing) {
    const stillEligible = recommendations.find((item) => item.id === String(existing.targetUser));
    if (stillEligible) {
      return { ...stillEligible, reason: existing.reasonText, reasonCode: existing.reasonCode, encounterDate };
    }
  }

  const target = recommendations[0] || null;
  if (!target) return null;

  const record = await DailyEncounter.findOneAndUpdate(
    { user: user._id, encounterDate },
    {
      $setOnInsert: {
        user: user._id,
        targetUser: target.id,
        reasonCode: target.reasonCode,
        reasonText: target.reason,
        encounterDate,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  return { ...target, reason: record.reasonText, reasonCode: record.reasonCode, encounterDate };
}

export async function sendSeeYouSignal({ sender, targetUserId }) {
  if (!mongoose.isValidObjectId(targetUserId)) {
    throw new ApiError(400, "Invalid target user ID");
  }

  if (String(sender._id) === String(targetUserId)) {
    throw new ApiError(400, "You cannot send an Orbit signal to yourself");
  }

  const [target, blockedIds] = await Promise.all([
    User.findById(targetUserId).select("name username role status creatorApprovalStatus").lean(),
    blockedUserIds(sender._id),
  ]);

  if (!target || target.status !== "active") {
    throw new ApiError(404, "Orbit recommendation not found");
  }

  if (blockedIds.has(String(target._id))) {
    throw new ApiError(403, "This Orbit signal is not available");
  }

  if (target.role === "creator" && target.creatorApprovalStatus !== "approved") {
    throw new ApiError(403, "This creator is not available in Orbit");
  }

  if (target.role === "creator") {
    const profile = await CreatorProfile.findOne({
      user: target._id,
      profileVisibility: "public",
      "privacySettings.allowDiscovery": { $ne: false },
    }).select("_id").lean();
    if (!profile) throw new ApiError(403, "This creator is not available in Orbit");
  }

  if (target.role === "fan") {
    const profile = await FanProfile.findOne({
      user: target._id,
      profileVisibility: "public",
      "privacySettings.allowDiscovery": { $ne: false },
    }).select("_id").lean();
    if (!profile) throw new ApiError(403, "This Orbit signal is not available");
  }

  const signal = await OrbitSignal.findOneAndUpdate(
    { sender: sender._id, targetUser: target._id, type: "SEE_YOU", status: "active" },
    { $setOnInsert: { sender: sender._id, targetUser: target._id, type: "SEE_YOU", status: "active" } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  await Notification.findOneAndUpdate(
    { user: target._id, dedupeKey: `orbit-see-you:${signal._id}` },
    {
      $setOnInsert: {
        user: target._id,
        type: "orbit_signal",
        title: `${sender.name || sender.username} saw you`,
        dedupeKey: `orbit-see-you:${signal._id}`,
      },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );

  return {
    signalId: String(signal._id),
    targetUserId: String(target._id),
    status: "sent",
    createdAt: signal.createdAt,
  };
}

export async function listSentSignals(userId) {
  const signals = await OrbitSignal.find({ sender: userId, type: "SEE_YOU", status: "active" }).sort({ createdAt: -1 }).lean();
  return signals.map((signal) => ({
    signalId: String(signal._id),
    targetUserId: String(signal.targetUser),
    status: "sent",
    createdAt: signal.createdAt,
  }));
}

export async function getOrbitCities() {
  const configured = await OrbitCityProgress.find({ enabled: true }).sort({ sortOrder: 1, currentCount: -1, city: 1 }).limit(5).lean();
  if (configured.length) {
    return configured.map((item) => ({
      city: item.city,
      country: item.countryCode || item.country,
      countryName: item.country,
      currentCount: item.currentCount,
      targetCount: item.targetCount,
      progressPercentage: Math.round((item.currentCount / item.targetCount) * 100),
      source: item.source,
    }));
  }

  const profiles = await CreatorProfile.find({
    profileVisibility: "public",
    "privacySettings.allowDiscovery": { $ne: false },
    city: { $ne: "" },
  })
    .populate({
      path: "user",
      match: { role: "creator", status: "active", creatorApprovalStatus: "approved" },
      select: "_id",
    })
    .select("city country user")
    .lean();

  const counts = new Map();
  for (const profile of profiles) {
    if (!profile.user || !profile.city) continue;
    const key = `${cleanText(profile.city, 80)}|${cleanText(profile.country, 80)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([key, currentCount]) => {
      const [city, country] = key.split("|");
      return { city, country, currentCount, targetCount: null, progressPercentage: null };
    })
    .sort((left, right) => right.currentCount - left.currentCount || left.city.localeCompare(right.city))
    .slice(0, 5);
}

export const orbitRecommendationTestUtils = {
  normalizeList,
  reasonForCandidate,
  resonanceTierFor,
  scoreCandidate,
  todayKey,
};
