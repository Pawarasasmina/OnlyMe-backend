import mongoose from "mongoose";
import AnalyticsEvent from "../models/AnalyticsEvent.js";
import DAWindow from "../models/DAWindow.js";
import FanProfile from "../models/FanProfile.js";
import PremiumMembership from "../models/PremiumMembership.js";
import ProfileMedia from "../models/ProfileMedia.js";
import ProfileRelationship from "../models/ProfileRelationship.js";
import Publication from "../models/Publication.js";
import SeenEngagement from "../models/SeenEngagement.js";
import StarsLedgerEntry from "../models/StarsLedgerEntry.js";
import Story from "../models/Story.js";
import StoryEngagement from "../models/StoryEngagement.js";
import User from "../models/User.js";
import WallEngagement from "../models/WallEngagement.js";
import WallPost from "../models/WallPost.js";
import WorldEntitlement from "../models/WorldEntitlement.js";
import { ACTIVE_MEMBERSHIP_STATUSES } from "../constants/financialConstants.js";

const CREATOR_EARNING_TYPES = [
  "WORLD_CREATOR_EARNING",
  "PREMIUM_CREATOR_EARNING",
  "DREAM_CREATOR_EARNING",
  "CHAT_GIFT_EARNING",
  "DA_CREATOR_EARNING",
  "CALL_CREATOR_EARNING",
];

const SOURCE_COLORS = {
  Discover: "#9CCBFF",
  Wall: "#6ECF97",
  Seen: "#B092FF",
};

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date, months) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
}

function periodWindows(now = new Date()) {
  const start = startOfUtcMonth(now);
  const previousStart = startOfUtcMonth(addMonths(start, -1));
  const elapsed = now.getTime() - start.getTime();
  const previousMonthEnd = start;
  const previousEnd = new Date(Math.min(previousStart.getTime() + elapsed, previousMonthEnd.getTime()));
  const weekStart = startOfUtcDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
  return { now, previousEnd, previousStart, start, weekStart };
}

function percentChange(current, previous) {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function money(stars) {
  return Number(((Number(stars) || 0) / 10).toFixed(2));
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: String(user._id || user.id),
    name: user.name || "",
    username: user.username || "",
    avatar: user.avatar || "",
    verified: Boolean(user.isVerified),
  };
}

function sourceLabel(source = "") {
  const normalized = String(source || "").toLowerCase();
  if (normalized.includes("discover") || normalized.includes("search")) return "Discover";
  if (normalized.includes("wall") || normalized === "home") return "Wall";
  if (normalized.includes("seen") || normalized.includes("publication")) return "Seen";
  return "";
}

export function percentageRows(rows = []) {
  const safeRows = rows.map((row) => ({ ...row, value: Math.max(0, Number(row.value) || 0) }));
  const total = safeRows.reduce((sum, row) => sum + row.value, 0);
  if (!total) return safeRows.map((row) => ({ ...row, percent: 0 }));
  const raw = safeRows.map((row, index) => {
    const exact = row.value / total * 100;
    return { ...row, exact, index, percent: Math.floor(exact) };
  });
  let remaining = 100 - raw.reduce((sum, row) => sum + row.percent, 0);
  raw.sort((left, right) => (right.exact - right.percent) - (left.exact - left.percent));
  for (const row of raw) {
    if (remaining <= 0) break;
    row.percent += 1;
    remaining -= 1;
  }
  return raw.sort((left, right) => left.index - right.index).map(({ exact: _exact, index: _index, ...row }) => row);
}

function median(values = []) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function sourceBucketForEntry(entry = {}) {
  if (["PREMIUM_CREATOR_EARNING", "WORLD_CREATOR_EARNING"].includes(entry.entryType)) return "worldSubscriptions";
  if (["DA_CREATOR_EARNING", "CALL_CREATOR_EARNING"].includes(entry.entryType)) return "directAccess";
  if (entry.entryType === "CHAT_GIFT_EARNING") return "gifts";
  if (entry.entryType === "DREAM_CREATOR_EARNING") return "dreamSupport";
  return "unlocks";
}

function earningDescription(entry = {}) {
  const person = entry.counterpartyUser?.name || entry.counterpartyUser?.username || "Someone";
  const title = entry.publication?.title || entry.publication?.publishedSnapshot?.metadata?.title || "";
  if (entry.entryType === "PREMIUM_CREATOR_EARNING") return title ? `${person} subscribed to your World` : `${person} became a resident`;
  if (entry.entryType === "WORLD_CREATOR_EARNING") return title ? `${person} unlocked ${title}` : `${person} unlocked your World`;
  if (entry.entryType === "DREAM_CREATOR_EARNING") return `${person} supported your dream`;
  if (entry.entryType === "CHAT_GIFT_EARNING") return `${person} sent a gift`;
  if (["DA_CREATOR_EARNING", "CALL_CREATOR_EARNING"].includes(entry.entryType)) return `${person} bought Direct Access`;
  return `${person} sent creator earnings`;
}

function baseMetric(value, previousValue) {
  return { changePercent: percentChange(value, previousValue), value };
}

async function contentAudience({ creatorId, publicationIds, storyIds, start, previousStart, previousEnd, now }) {
  const entityIds = [...publicationIds.map(String), ...storyIds.map(String)];
  const contentMatch = entityIds.length
    ? {
      $or: [
        { entityId: { $in: entityIds } },
        { entityId: String(creatorId), entityType: "profile" },
      ],
    }
    : { entityId: String(creatorId), entityType: "profile" };
  const eventTypes = ["CONTENT_IMPRESSION", "CONTENT_VIEW", "CONTENT_OPENED", "SEEN_VIEW", "STORY_VIEW", "PROFILE_VIEW"];
  const [currentUsers, previousUsers, historicalUsers, sourceRows] = await Promise.all([
    AnalyticsEvent.distinct("userId", { eventType: { $in: eventTypes }, createdAt: { $gte: start, $lte: now }, ...contentMatch }),
    AnalyticsEvent.distinct("userId", { eventType: { $in: eventTypes }, createdAt: { $gte: previousStart, $lte: previousEnd }, ...contentMatch }),
    AnalyticsEvent.distinct("userId", { eventType: { $in: eventTypes }, createdAt: { $lt: start }, ...contentMatch }),
    AnalyticsEvent.aggregate([
      { $match: { eventType: { $in: eventTypes }, createdAt: { $gte: start, $lte: now }, ...contentMatch } },
      { $group: { _id: "$source", value: { $sum: 1 } } },
    ]),
  ]);
  const previousSet = new Set(historicalUsers.map(String));
  const newUsers = currentUsers.filter((id) => !previousSet.has(String(id))).length;
  const returningUsers = currentUsers.length - newUsers;
  const sourceTotals = new Map([["Discover", 0], ["Wall", 0], ["Seen", 0]]);
  for (const row of sourceRows) {
    const label = sourceLabel(row._id);
    if (label) sourceTotals.set(label, (sourceTotals.get(label) || 0) + row.value);
  }
  return {
    currentUsers,
    discoverySources: percentageRows([...sourceTotals].map(([label, value]) => ({ color: SOURCE_COLORS[label], label, value }))),
    newVsReturning: currentUsers.length
      ? { newPercent: Math.round(newUsers / currentUsers.length * 100), returningPercent: Math.round(returningUsers / currentUsers.length * 100) }
      : { newPercent: null, returningPercent: null },
    reach: baseMetric(currentUsers.length, previousUsers.length),
  };
}

async function bestSeenFor(seens) {
  if (!seens.length) return null;
  const ids = seens.map((seen) => seen._id);
  const analyticsRows = await AnalyticsEvent.aggregate([
    { $match: { eventType: { $in: ["CONTENT_VIEW", "CONTENT_OPENED", "SEEN_VIEW"] }, entityId: { $in: ids.map(String) } } },
    { $group: { _id: "$entityId", value: { $sum: 1 } } },
  ]);
  const engagementRows = await SeenEngagement.aggregate([
    { $match: { publication: { $in: ids }, type: "WALKED" } },
    { $group: { _id: "$publication", value: { $sum: 1 } } },
  ]);
  const scores = new Map();
  analyticsRows.forEach((row) => scores.set(String(row._id), row.value));
  engagementRows.forEach((row) => scores.set(String(row._id), Math.max(scores.get(String(row._id)) || 0, row.value)));
  const best = seens.reduce((selected, seen) => (scores.get(String(seen._id)) || 0) > (scores.get(String(selected?._id)) || 0) ? seen : selected, seens[0]);
  const value = scores.get(String(best._id)) || 0;
  return {
    id: String(best._id),
    metricLabel: value ? `${value.toLocaleString()} saw this` : "Views pending",
    title: best.title || "Untitled Seen",
    value,
  };
}

async function locationRowsFor(wallPosts) {
  const located = wallPosts.filter((post) => post.location);
  if (!located.length) return { best: null };
  const engagementRows = await WallEngagement.aggregate([
    { $match: { post: { $in: located.map((post) => post._id) } } },
    { $group: { _id: "$post", value: { $sum: 1 } } },
  ]);
  const byPost = new Map(engagementRows.map((row) => [String(row._id), row.value]));
  const byLocation = new Map();
  for (const post of located) {
    const current = byLocation.get(post.location) || 0;
    byLocation.set(post.location, current + (byPost.get(String(post._id)) || 1));
  }
  const rows = percentageRows([...byLocation].map(([label, value]) => ({ label, value }))).sort((a, b) => b.value - a.value);
  const top = rows[0];
  return { best: top ? { metricLabel: `${top.percent}% of your reach`, title: top.label, value: top.value } : null };
}

async function recentActivity({ publicationIds, wallPostIds, creatorId }) {
  const [seenRows, wallRows, followRows] = await Promise.all([
    publicationIds.length ? SeenEngagement.find({ publication: { $in: publicationIds }, type: { $in: ["REACTION", "SHARE", "SAVE", "COMMENT"] } }).sort({ createdAt: -1 }).limit(8).populate("user", "name username avatar isVerified").lean() : [],
    wallPostIds.length ? WallEngagement.find({ post: { $in: wallPostIds }, type: { $in: ["REACTION", "SHARE", "SAVE", "COMMENT"] } }).sort({ createdAt: -1 }).limit(8).populate("user", "name username avatar isVerified").lean() : [],
    ProfileRelationship.find({ target: creatorId, type: "FOLLOW" }).sort({ createdAt: -1 }).limit(5).populate("actor", "name username avatar isVerified").lean(),
  ]);
  const items = [
    ...seenRows.map((row) => ({ createdAt: row.createdAt, text: `${row.user?.name || row.user?.username || "Someone"} ${row.type === "SAVE" ? "saved" : row.type === "SHARE" ? "reposted" : row.type === "COMMENT" ? "commented on" : "reacted to"} your Seen`, type: "seen" })),
    ...wallRows.map((row) => ({ createdAt: row.createdAt, text: `${row.user?.name || row.user?.username || "Someone"} ${row.type === "SAVE" ? "saved" : row.type === "SHARE" ? "shared" : row.type === "COMMENT" ? "commented on" : "reacted to"} your note`, type: "wall" })),
    ...followRows.map((row) => ({ createdAt: row.createdAt, text: `${row.actor?.name || row.actor?.username || "Someone"} followed you`, type: "follow" })),
  ];
  return items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
}

async function audienceBreakdown(followerIds) {
  if (!followerIds.length) return { interests: [], topCities: [] };
  const [fanProfiles, creatorProfiles] = await Promise.all([
    FanProfile.find({ user: { $in: followerIds } }).select("user city interests discoverSettings.topics").lean(),
    User.find({ _id: { $in: followerIds } }).select("_id").lean(),
  ]);
  const knownUserIds = new Set(creatorProfiles.map((user) => String(user._id)));
  const cityCounts = new Map();
  const interestCounts = new Map();
  for (const profile of fanProfiles) {
    if (!knownUserIds.has(String(profile.user))) continue;
    const city = String(profile.city || "").trim();
    if (city) cityCounts.set(city, (cityCounts.get(city) || 0) + 1);
    for (const interest of profile.interests || []) {
      const label = String(interest || "").trim();
      if (label) interestCounts.set(label, (interestCounts.get(label) || 0) + 1);
    }
    for (const topic of profile.discoverSettings?.topics || []) {
      if (topic.preference !== "interested") continue;
      const label = String(topic.label || "").trim();
      if (label) interestCounts.set(label, (interestCounts.get(label) || 0) + 1);
    }
  }
  const topCities = percentageRows([...cityCounts].map(([label, value]) => ({ label, value }))).sort((a, b) => b.value - a.value).slice(0, 3);
  const interests = [...interestCounts].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label, value }));
  return { interests, topCities };
}

export async function buildCreatorDashboard(userId, now = new Date()) {
  const creatorId = new mongoose.Types.ObjectId(userId);
  const { previousEnd, previousStart, start, weekStart } = periodWindows(now);
  const [
    publications,
    wallPosts,
    profileMediaCount,
    followerRows,
    followingCount,
    creatorUser,
  ] = await Promise.all([
    Publication.find({ creator: creatorId }).select("title kind status pricing publishedAt planet publishedSnapshot.metadata.title createdAt").lean(),
    WallPost.find({ creator: creatorId, status: "PUBLISHED" }).select("text context location createdAt").sort({ createdAt: -1 }).limit(100).lean(),
    ProfileMedia.countDocuments({ user: creatorId, type: "image" }),
    ProfileRelationship.find({ target: creatorId, type: "FOLLOW" }).select("actor createdAt").lean(),
    ProfileRelationship.countDocuments({ actor: creatorId, type: "FOLLOW" }),
    User.findById(creatorId).select("avatar activeStatus").lean(),
  ]);

  const publishedSeens = publications.filter((item) => item.kind === "SEEN" && item.status === "PUBLISHED");
  const publicationIds = publications.map((item) => item._id);
  const seenIds = publishedSeens.map((item) => item._id);
  const wallPostIds = wallPosts.map((item) => item._id);
  const stories = await Story.find({ creator: creatorId }).select("_id").lean();
  const storyIds = stories.map((story) => story._id);

  const [
    content,
    currentSeenViews,
    previousSeenViews,
    currentProfileVisits,
    previousProfileVisits,
    directWindows,
    currentLedger,
    previousLedger,
    recentLedger,
    memberships,
    worldEntriesThisWeek,
    bestSeen,
    locations,
    activity,
    averageStoryViewsRow,
  ] = await Promise.all([
    contentAudience({ creatorId, now, previousEnd, previousStart, publicationIds, start, storyIds }),
    seenIds.length ? AnalyticsEvent.countDocuments({ eventType: { $in: ["CONTENT_VIEW", "CONTENT_OPENED", "SEEN_VIEW"] }, entityId: { $in: seenIds.map(String) }, createdAt: { $gte: start, $lte: now } }) : 0,
    seenIds.length ? AnalyticsEvent.countDocuments({ eventType: { $in: ["CONTENT_VIEW", "CONTENT_OPENED", "SEEN_VIEW"] }, entityId: { $in: seenIds.map(String) }, createdAt: { $gte: previousStart, $lte: previousEnd } }) : 0,
    AnalyticsEvent.countDocuments({ eventType: "PROFILE_VIEW", entityId: String(creatorId), createdAt: { $gte: start, $lte: now } }),
    AnalyticsEvent.countDocuments({ eventType: "PROFILE_VIEW", entityId: String(creatorId), createdAt: { $gte: previousStart, $lte: previousEnd } }),
    DAWindow.find({ creator: creatorId, openedAt: { $gte: start, $lte: now } }).select("openedAt firstCreatorReplyAt answeredAt status settlementStatus").lean(),
    StarsLedgerEntry.find({ accountUser: creatorId, direction: "CREDIT", entryType: { $in: CREATOR_EARNING_TYPES }, createdAt: { $gte: start, $lte: now } }).lean(),
    StarsLedgerEntry.find({ accountUser: creatorId, direction: "CREDIT", entryType: { $in: CREATOR_EARNING_TYPES }, createdAt: { $gte: previousStart, $lte: previousEnd } }).lean(),
    StarsLedgerEntry.find({ accountUser: creatorId, direction: "CREDIT", entryType: { $in: CREATOR_EARNING_TYPES } }).sort({ createdAt: -1 }).limit(5).populate("counterpartyUser", "name username avatar isVerified").populate("publication", "title kind planet publishedSnapshot.metadata.title").lean(),
    PremiumMembership.find({ creator: creatorId, status: { $in: ACTIVE_MEMBERSHIP_STATUSES } }).select("user starsPerPeriod status currentPeriodEnd").lean(),
    WorldEntitlement.distinct("user", { creator: creatorId, status: "ACTIVE", grantedAt: { $gte: weekStart, $lte: now } }),
    bestSeenFor(publishedSeens),
    locationRowsFor(wallPosts),
    recentActivity({ creatorId, publicationIds, wallPostIds }),
    StoryEngagement.aggregate([{ $match: { story: { $in: storyIds } } }, { $group: { _id: "$story", views: { $sum: { $cond: ["$viewedAt", 1, 0] } } } }, { $group: { _id: null, average: { $avg: "$views" } } }]),
  ]);

  const answered = directWindows.filter((item) => item.firstCreatorReplyAt || item.answeredAt);
  const responseMinutes = answered.map((item) => Math.round((new Date(item.firstCreatorReplyAt || item.answeredAt).getTime() - new Date(item.openedAt).getTime()) / 60000));
  const currentStars = currentLedger.reduce((sum, entry) => sum + entry.signedAmount, 0);
  const previousStars = previousLedger.reduce((sum, entry) => sum + entry.signedAmount, 0);
  const bySourceStars = { directAccess: 0, dreamSupport: 0, gifts: 0, unlocks: 0, worldSubscriptions: 0 };
  currentLedger.forEach((entry) => { bySourceStars[sourceBucketForEntry(entry)] += entry.signedAmount; });

  const followerIds = followerRows.map((row) => row.actor);
  const [newFollowersThisWeek, mutualRows, audience] = await Promise.all([
    ProfileRelationship.countDocuments({ target: creatorId, type: "FOLLOW", createdAt: { $gte: weekStart, $lte: now } }),
    followerIds.length ? ProfileRelationship.find({ actor: creatorId, target: { $in: followerIds }, type: "FOLLOW" }).select("target").lean() : [],
    audienceBreakdown(followerIds),
  ]);

  const creatorPath = {
    followsThree: followingCount >= 3,
    profilePhotos: profileMediaCount > 0 || Boolean(creatorUser?.avatar),
    publishedSeen: publishedSeens.length > 0,
    wallPost: wallPosts.length > 0,
  };
  const completed = Object.values(creatorPath).filter(Boolean).length;

  const activeMemberships = memberships.filter((item) => new Date(item.currentPeriodEnd) > now);
  const recurringStars = activeMemberships.reduce((sum, item) => sum + Number(item.starsPerPeriod || 0), 0);

  return {
    period: { end: now.toISOString(), start: start.toISOString() },
    creatorPath: { ...creatorPath, completed, total: 4 },
    overview: {
      bestPerformers: {
        location: locations.best,
        seen: bestSeen,
        status: null,
      },
      discoverySources: content.discoverySources,
      earnings: { amount: money(currentStars), changePercent: percentChange(currentStars, previousStars), currency: "USD" },
      newFollowers: { periodLabel: "this week", value: newFollowersThisWeek },
      profileVisits: baseMetric(currentProfileVisits, previousProfileVisits),
      reach: content.reach,
      recentActivity: activity,
      responseRate: directWindows.length ? { medianResponseMinutes: median(responseMinutes), value: Math.round(answered.length / directWindows.length * 100) } : { medianResponseMinutes: null, value: null },
      seenViews: baseMetric(currentSeenViews, previousSeenViews),
    },
    audience: {
      averageStoryViews: averageStoryViewsRow[0]?.average == null ? null : Math.round(averageStoryViewsRow[0].average),
      enteredWorldThisWeek: new Set([...worldEntriesThisWeek.map(String), ...activeMemberships.filter((item) => item.createdAt >= weekStart).map((item) => String(item.user))]).size,
      followers: followerRows.length,
      interests: audience.interests,
      mutualConnections: mutualRows.length,
      newFollowersThisWeek,
      newVsReturning: content.newVsReturning,
      topCities: audience.topCities,
    },
    earnings: {
      bySource: Object.fromEntries(Object.entries(bySourceStars).map(([key, value]) => [key, money(value)])),
      changePercent: percentChange(currentStars, previousStars),
      currency: "USD",
      recent: recentLedger.map((entry) => ({
        amount: money(entry.signedAmount),
        counterparty: publicUser(entry.counterpartyUser),
        createdAt: entry.createdAt,
        description: earningDescription(entry),
        id: String(entry._id),
        metadata: { stars: entry.signedAmount },
        type: entry.entryType,
      })),
      residents: { count: activeMemberships.length, monthlyRecurringRevenue: money(recurringStars) },
      thisMonth: money(currentStars),
    },
  };
}
