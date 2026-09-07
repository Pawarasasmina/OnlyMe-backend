import Content from "../models/Content.js";
import AnalyticsEvent from "../models/AnalyticsEvent.js";
import FeedPost from "../models/FeedPost.js";
import Message from "../models/Message.js";
import MessageReport from "../models/MessageReport.js";
import PremiumMembership from "../models/PremiumMembership.js";
import ProfileRelationship from "../models/ProfileRelationship.js";
import Publication from "../models/Publication.js";
import SavedItem from "../models/SavedItem.js";
import SeenEngagement from "../models/SeenEngagement.js";
import Story from "../models/Story.js";
import StoryEngagement from "../models/StoryEngagement.js";
import Subscription from "../models/Subscription.js";
import Transaction from "../models/Transaction.js";
import User from "../models/User.js";
import WallEngagement from "../models/WallEngagement.js";
import WallPost from "../models/WallPost.js";
import WallShareEngagement from "../models/WallShareEngagement.js";
import {
  contentFunnelAnalytics,
  impressionCountsByContent,
  profileAnalytics,
  retentionAnalytics,
  searchAnalytics,
  sessionAnalytics,
  TRACKING_START_DATE,
} from "./analyticsEventService.js";
import ApiError from "../utils/ApiError.js";

const DAY = 24 * 60 * 60 * 1000;
const SUPPORTED_CONTENT_TYPES = ["feed_post", "content", "seen", "world", "premium_world", "story", "wall_post"];
const SUPPORTED_STATUSES = ["published", "draft", "pending_review", "changes_requested", "rejected", "archived", "removed", "deleted"];
const PDF_COLORS = ["#f97316", "#2563eb", "#10b981", "#8b5cf6", "#f59e0b", "#64748b", "#ef4444"];

const toNumber = (value) => Number(value || 0);
const idString = (value) => String(value?._id || value || "");
const pct = (current, previous) => previous > 0 ? Number((((current - previous) / previous) * 100).toFixed(1)) : null;
const percent = (numerator, denominator) => denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(2)) : null;
const dateMatch = (field, startDate, endDate) => ({ [field]: { $gte: startDate, $lte: endDate } });
const normalizeStatus = (status) => String(status || "").toLowerCase();
const formatReportValue = (value) => value == null ? "N/A" : Number.isFinite(Number(value)) ? Number(value).toLocaleString("en-US") : String(value);

export function parseAnalyticsRange(query = {}) {
  const now = new Date();
  const endDate = query.endDate ? new Date(query.endDate) : now;
  const startDate = query.startDate ? new Date(query.startDate) : new Date(endDate.getTime() - 29 * DAY);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) throw new ApiError(400, "Invalid analytics date range");
  if (startDate > endDate) throw new ApiError(400, "startDate must be before endDate");
  if (endDate.getTime() - startDate.getTime() > 370 * DAY) throw new ApiError(400, "Analytics range cannot exceed 370 days");

  const spanDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / DAY));
  const granularity = query.granularity || (spanDays <= 2 ? "hour" : spanDays <= 45 ? "day" : spanDays <= 180 ? "week" : "month");
  if (!["hour", "day", "week", "month"].includes(granularity)) throw new ApiError(400, "Unsupported analytics granularity");

  const previousEndDate = new Date(startDate.getTime() - 1);
  const previousStartDate = new Date(previousEndDate.getTime() - (endDate.getTime() - startDate.getTime()));

  return { startDate, endDate, previousStartDate, previousEndDate, granularity };
}

export function buildBuckets(startDate, endDate, granularity) {
  const buckets = [];
  const cursor = new Date(startDate);
  cursor.setUTCMinutes(0, 0, 0);
  if (granularity !== "hour") cursor.setUTCHours(0, 0, 0, 0);
  if (granularity === "month") cursor.setUTCDate(1);

  while (cursor <= endDate) {
    const key = bucketKey(cursor, granularity);
    buckets.push({ key, date: new Date(cursor), label: labelFor(cursor, granularity) });
    if (granularity === "hour") cursor.setUTCHours(cursor.getUTCHours() + 1);
    else if (granularity === "day") cursor.setUTCDate(cursor.getUTCDate() + 1);
    else if (granularity === "week") cursor.setUTCDate(cursor.getUTCDate() + 7);
    else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return buckets;
}

function bucketKey(date, granularity) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  if (granularity === "hour") return `${year}-${month}-${day} ${String(date.getUTCHours()).padStart(2, "0")}:00`;
  if (granularity === "month") return `${year}-${month}`;
  if (granularity === "week") {
    const weekStart = new Date(Date.UTC(year, date.getUTCMonth(), date.getUTCDate()));
    weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
    return weekStart.toISOString().slice(0, 10);
  }
  return `${year}-${month}-${day}`;
}

function dateToString(format, expression) {
  if (format === "hour") return { $dateToString: { format: "%Y-%m-%d %H:00", date: expression, timezone: "UTC" } };
  if (format === "month") return { $dateToString: { format: "%Y-%m", date: expression, timezone: "UTC" } };
  if (format === "week") return { $dateToString: { format: "%Y-%m-%d", date: { $dateTrunc: { date: expression, unit: "week", timezone: "UTC", startOfWeek: "sun" } }, timezone: "UTC" } };
  return { $dateToString: { format: "%Y-%m-%d", date: expression, timezone: "UTC" } };
}

function labelFor(date, granularity) {
  if (granularity === "hour") return `${date.toISOString().slice(5, 10)} ${String(date.getUTCHours()).padStart(2, "0")}:00`;
  if (granularity === "month") return date.toISOString().slice(0, 7);
  return date.toISOString().slice(5, 10);
}

function hydrateBuckets(buckets, rows, series, keyField = "_id") {
  const byKey = new Map(rows.map((row) => [row[keyField], row]));
  return buckets.map((bucket) => {
    const row = byKey.get(bucket.key) || {};
    return series.reduce((item, name) => ({ ...item, [name]: toNumber(row[name]) }), { key: bucket.key, label: bucket.label, date: bucket.date });
  });
}

async function countInRange(Model, startDate, endDate, filter = {}, field = "createdAt") {
  return Model.countDocuments({ ...filter, ...dateMatch(field, startDate, endDate) });
}

async function countFeedPostArray(field, startDate, endDate) {
  const [row] = await FeedPost.aggregate([
    { $match: { deletedAt: null } },
    { $project: { count: { $size: { $filter: { input: `$${field}`, as: "item", cond: { $and: [{ $gte: ["$$item.createdAt", startDate] }, { $lte: ["$$item.createdAt", endDate] }] } } } } } },
    { $group: { _id: null, total: { $sum: "$count" } } },
  ]);
  return toNumber(row?.total);
}

async function distinctActivityUsers(startDate, endDate) {
  const [lastSeen, wall, wallShare, seen, story, saves, follows, messages] = await Promise.all([
    User.distinct("_id", { lastSeenAt: { $gte: startDate, $lte: endDate } }),
    WallEngagement.distinct("user", dateMatch("createdAt", startDate, endDate)),
    WallShareEngagement.distinct("user", dateMatch("createdAt", startDate, endDate)),
    SeenEngagement.distinct("user", dateMatch("createdAt", startDate, endDate)),
    StoryEngagement.distinct("fan", { $or: [dateMatch("createdAt", startDate, endDate), dateMatch("viewedAt", startDate, endDate)] }),
    SavedItem.distinct("user", dateMatch("createdAt", startDate, endDate)),
    ProfileRelationship.distinct("actor", dateMatch("createdAt", startDate, endDate)),
    Message.distinct("sender", { deletedAt: null, ...dateMatch("createdAt", startDate, endDate) }),
  ]);
  return new Set([...lastSeen, ...wall, ...wallShare, ...seen, ...story, ...saves, ...follows, ...messages].map(idString)).size;
}

async function userGrowth(range, buckets) {
  const rows = await User.aggregate([
    { $match: dateMatch("createdAt", range.startDate, range.endDate) },
    { $group: { _id: dateToString(range.granularity, "$createdAt"), total: { $sum: 1 }, fans: { $sum: { $cond: [{ $eq: ["$role", "fan"] }, 1, 0] } }, creators: { $sum: { $cond: [{ $eq: ["$creatorApprovalStatus", "approved"] }, 1, 0] } }, admins: { $sum: { $cond: [{ $eq: ["$role", "admin"] }, 1, 0] } } } },
    { $sort: { _id: 1 } },
  ]);
  return hydrateBuckets(buckets, rows, ["total", "fans", "creators", "admins"]);
}

async function distribution(Model, field, filter = {}) {
  return Model.aggregate([{ $match: filter }, { $group: { _id: `$${field}`, count: { $sum: 1 } } }, { $sort: { count: -1 } }]);
}

async function contentCreation(range, buckets) {
  const [posts, content, publications, stories, wallPosts] = await Promise.all([
    FeedPost.aggregate([{ $match: { deletedAt: null, ...dateMatch("createdAt", range.startDate, range.endDate) } }, { $group: { _id: dateToString(range.granularity, "$createdAt"), feedPosts: { $sum: 1 } } }]),
    Content.aggregate([{ $match: dateMatch("createdAt", range.startDate, range.endDate) }, { $group: { _id: dateToString(range.granularity, "$createdAt"), content: { $sum: 1 } } }]),
    Publication.aggregate([{ $match: dateMatch("createdAt", range.startDate, range.endDate) }, { $group: { _id: dateToString(range.granularity, "$createdAt"), seens: { $sum: { $cond: [{ $eq: ["$kind", "SEEN"] }, 1, 0] } }, worlds: { $sum: { $cond: [{ $in: ["$kind", ["WORLD", "PREMIUM_WORLD"]] }, 1, 0] } } } }]),
    Story.aggregate([{ $match: dateMatch("createdAt", range.startDate, range.endDate) }, { $group: { _id: dateToString(range.granularity, "$createdAt"), stories: { $sum: 1 } } }]),
    WallPost.aggregate([{ $match: dateMatch("createdAt", range.startDate, range.endDate) }, { $group: { _id: dateToString(range.granularity, "$createdAt"), wallPosts: { $sum: 1 } } }]),
  ]);
  const merged = new Map();
  for (const row of [...posts, ...content, ...publications, ...stories, ...wallPosts]) merged.set(row._id, { ...(merged.get(row._id) || { _id: row._id }), ...row });
  return hydrateBuckets(buckets, [...merged.values()], ["feedPosts", "content", "seens", "worlds", "stories", "wallPosts"]);
}

async function engagementSummary(startDate, endDate) {
  const [
    feedViews, feedReactions, feedComments, feedSaves, feedShares,
    wallReactions, wallComments, wallSaves, wallShares,
    shareReactions, shareComments, shareSaves,
    seenReactions, seenComments, seenSaves, seenShares, seenWalks,
    storyViews, storyReactions, follows, messages,
  ] = await Promise.all([
    FeedPost.aggregate([{ $match: { deletedAt: null } }, { $project: { count: { $size: { $filter: { input: "$views", as: "item", cond: { $and: [{ $gte: ["$$item.viewedAt", startDate] }, { $lte: ["$$item.viewedAt", endDate] }] } } } } } }, { $group: { _id: null, total: { $sum: "$count" } } }]).then((r) => toNumber(r[0]?.total)),
    countFeedPostArray("reactions", startDate, endDate),
    countFeedPostArray("comments", startDate, endDate),
    countFeedPostArray("saves", startDate, endDate),
    countFeedPostArray("shares", startDate, endDate),
    WallEngagement.countDocuments({ type: "REACTION", ...dateMatch("createdAt", startDate, endDate) }),
    WallEngagement.countDocuments({ type: "COMMENT", ...dateMatch("createdAt", startDate, endDate) }),
    WallEngagement.countDocuments({ type: "SAVE", ...dateMatch("createdAt", startDate, endDate) }),
    WallEngagement.countDocuments({ type: "SHARE", ...dateMatch("createdAt", startDate, endDate) }),
    WallShareEngagement.countDocuments({ type: "REACTION", ...dateMatch("createdAt", startDate, endDate) }),
    WallShareEngagement.countDocuments({ type: "COMMENT", ...dateMatch("createdAt", startDate, endDate) }),
    WallShareEngagement.countDocuments({ type: "SAVE", ...dateMatch("createdAt", startDate, endDate) }),
    SeenEngagement.countDocuments({ type: "REACTION", ...dateMatch("createdAt", startDate, endDate) }),
    SeenEngagement.countDocuments({ type: "COMMENT", ...dateMatch("createdAt", startDate, endDate) }),
    SeenEngagement.countDocuments({ type: "SAVE", ...dateMatch("createdAt", startDate, endDate) }),
    SeenEngagement.countDocuments({ type: "SHARE", ...dateMatch("createdAt", startDate, endDate) }),
    SeenEngagement.countDocuments({ type: "WALKED", ...dateMatch("createdAt", startDate, endDate) }),
    StoryEngagement.countDocuments({ viewedAt: { $gte: startDate, $lte: endDate } }),
    StoryEngagement.countDocuments({ reaction: { $ne: "" }, ...dateMatch("createdAt", startDate, endDate) }),
    ProfileRelationship.countDocuments({ type: "FOLLOW", ...dateMatch("createdAt", startDate, endDate) }),
    Message.countDocuments({ deletedAt: null, ...dateMatch("createdAt", startDate, endDate) }),
  ]);
  const reactions = feedReactions + wallReactions + shareReactions + seenReactions + storyReactions;
  const comments = feedComments + wallComments + shareComments + seenComments;
  const saves = feedSaves + wallSaves + shareSaves + seenSaves;
  const shares = feedShares + wallShares + seenShares;
  const views = feedViews + storyViews + seenWalks;
  const total = views + reactions + comments + saves + shares + follows + messages;
  const rateDenominator = views;
  return { views, reactions, comments, saves, shares, follows, messages, storyViews, seenWalks, total, engagementRate: rateDenominator ? Number((((reactions + comments + saves + shares) / rateDenominator) * 100).toFixed(2)) : null };
}

async function engagementTrend(range, buckets) {
  const [wall, seen, reports, messages] = await Promise.all([
    WallEngagement.aggregate([{ $match: dateMatch("createdAt", range.startDate, range.endDate) }, { $group: { _id: dateToString(range.granularity, "$createdAt"), engagements: { $sum: 1 } } }]),
    SeenEngagement.aggregate([{ $match: dateMatch("createdAt", range.startDate, range.endDate) }, { $group: { _id: dateToString(range.granularity, "$createdAt"), engagements: { $sum: 1 } } }]),
    MessageReport.aggregate([{ $match: dateMatch("createdAt", range.startDate, range.endDate) }, { $group: { _id: dateToString(range.granularity, "$createdAt"), reports: { $sum: 1 } } }]),
    Message.aggregate([{ $match: { deletedAt: null, ...dateMatch("createdAt", range.startDate, range.endDate) } }, { $group: { _id: dateToString(range.granularity, "$createdAt"), messages: { $sum: 1 } } }]),
  ]);
  const merged = new Map();
  for (const row of [...wall, ...seen, ...reports, ...messages]) {
    const current = merged.get(row._id) || { _id: row._id, engagements: 0, messages: 0, reports: 0 };
    current.engagements += toNumber(row.engagements);
    current.messages += toNumber(row.messages);
    current.reports += toNumber(row.reports);
    merged.set(row._id, current);
  }
  return hydrateBuckets(buckets, [...merged.values()], ["engagements", "messages", "reports"]);
}

async function topContent({ page, limit, sort }) {
  const impressionMap = await impressionCountsByContent();
  const feedRows = await FeedPost.find({ deletedAt: null }).populate("author", "name username avatar").sort({ viewCount: -1, createdAt: -1 }).limit(120).lean();
  const publications = await Publication.find({ status: { $in: ["PUBLISHED", "ARCHIVED", "REMOVED"] } }).populate("creator", "name username avatar").sort({ publishedAt: -1, createdAt: -1 }).limit(120).lean();
  const publicationEngagement = await SeenEngagement.aggregate([{ $group: { _id: "$publication", reactions: { $sum: { $cond: [{ $eq: ["$type", "REACTION"] }, 1, 0] } }, comments: { $sum: { $cond: [{ $eq: ["$type", "COMMENT"] }, 1, 0] } }, saves: { $sum: { $cond: [{ $eq: ["$type", "SAVE"] }, 1, 0] } }, views: { $sum: { $cond: [{ $eq: ["$type", "WALKED"] }, 1, 0] } } } }]);
  const seenById = new Map(publicationEngagement.map((row) => [idString(row._id), row]));
  const rows = [
    ...feedRows.map((post) => {
      const impressions = impressionMap.get(`feed_post:${idString(post._id)}`) || 0;
      const views = toNumber(post.viewCount);
      const reactions = post.reactions?.length || 0;
      const comments = toNumber(post.commentCount);
      const saves = toNumber(post.saveCount);
      const shares = toNumber(post.shareCount);
      const engagements = reactions + comments + saves + shares;
      return { id: idString(post._id), title: post.text?.slice(0, 80) || "Feed post", type: "Feed post", creator: post.author && { name: post.author.name, username: post.author.username }, createdAt: post.createdAt, impressions, views, viewRate: impressions ? Number(((views / impressions) * 100).toFixed(2)) : null, reactions, comments, saves, shares, engagements, engagementRate: impressions ? Number(((engagements / impressions) * 100).toFixed(2)) : null, engagement: views + engagements, status: post.status, route: `/posts/${post._id}` };
    }),
    ...publications.map((item) => {
      const e = seenById.get(idString(item._id)) || {};
      const entityType = item.kind === "SEEN" ? "seen" : "world";
      const impressions = impressionMap.get(`${entityType}:${idString(item._id)}`) || impressionMap.get(`publication:${idString(item._id)}`) || 0;
      const views = toNumber(e.views);
      const reactions = toNumber(e.reactions);
      const comments = toNumber(e.comments);
      const saves = toNumber(e.saves);
      const shares = 0;
      const engagements = reactions + comments + saves + shares;
      return { id: idString(item._id), title: item.title || item.kind, type: item.kind?.replaceAll("_", " "), creator: item.creator && { name: item.creator.name, username: item.creator.username }, createdAt: item.createdAt, impressions, views, viewRate: impressions ? Number(((views / impressions) * 100).toFixed(2)) : null, reactions, comments, saves, shares, engagements, engagementRate: impressions ? Number(((engagements / impressions) * 100).toFixed(2)) : null, engagement: views + engagements, status: item.status, route: `/admin/publication-moderation/${item._id}` };
    }),
  ];
  const sortKey = ["impressions", "views", "viewRate", "reactions", "comments", "saves", "shares", "engagementRate", "engagement", "createdAt"].includes(sort) ? sort : "engagement";
  rows.sort((a, b) => sortKey === "createdAt" ? new Date(b.createdAt) - new Date(a.createdAt) : toNumber(b[sortKey]) - toNumber(a[sortKey]));
  const total = rows.length;
  return { items: rows.slice((page - 1) * limit, page * limit), pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } };
}

async function creatorPerformance({ limit = 10 }) {
  const [content, publications, posts, followers, seen, wall] = await Promise.all([
    Content.aggregate([{ $group: { _id: "$creator", content: { $sum: 1 } } }]),
    Publication.aggregate([{ $group: { _id: "$creator", publications: { $sum: 1 } } }]),
    FeedPost.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: "$author", posts: { $sum: 1 }, views: { $sum: "$viewCount" }, comments: { $sum: "$commentCount" }, saves: { $sum: "$saveCount" }, shares: { $sum: "$shareCount" }, reactions: { $sum: { $size: "$reactions" } } } }]),
    ProfileRelationship.aggregate([{ $match: { type: "FOLLOW" } }, { $group: { _id: "$target", followers: { $sum: 1 } } }]),
    SeenEngagement.aggregate([{ $lookup: { from: "publications", localField: "publication", foreignField: "_id", as: "publication" } }, { $unwind: "$publication" }, { $group: { _id: "$publication.creator", seenEngagements: { $sum: 1 } } }]),
    WallEngagement.aggregate([{ $lookup: { from: "wallposts", localField: "post", foreignField: "_id", as: "post" } }, { $unwind: "$post" }, { $group: { _id: "$post.creator", wallEngagements: { $sum: 1 } } }]),
  ]);
  const map = new Map();
  for (const collection of [content, publications, posts, followers, seen, wall]) {
    for (const row of collection) map.set(idString(row._id), { ...(map.get(idString(row._id)) || { id: idString(row._id) }), ...row });
  }
  const users = await User.find({ _id: { $in: [...map.keys()] } }).select("name username avatar isVerified").lean();
  const userMap = new Map(users.map((user) => [idString(user._id), user]));
  return [...map.values()].map((row) => {
    const user = userMap.get(row.id);
    const engagement = toNumber(row.views) + toNumber(row.reactions) + toNumber(row.comments) + toNumber(row.saves) + toNumber(row.shares) + toNumber(row.seenEngagements) + toNumber(row.wallEngagements);
    return { creator: user && { id: row.id, name: user.name, username: user.username, avatar: user.avatar, verified: Boolean(user.isVerified) }, content: toNumber(row.content) + toNumber(row.publications) + toNumber(row.posts), views: toNumber(row.views), reactions: toNumber(row.reactions), comments: toNumber(row.comments), saves: toNumber(row.saves), followers: toNumber(row.followers), engagement };
  }).filter((row) => row.creator).sort((a, b) => b.engagement - a.engagement).slice(0, limit);
}

async function mostActiveUsers({ limit = 10 }) {
  const [wall, seen, saves, follows, messages, postComments] = await Promise.all([
    WallEngagement.aggregate([{ $group: { _id: "$user", actions: { $sum: 1 }, comments: { $sum: { $cond: [{ $eq: ["$type", "COMMENT"] }, 1, 0] } }, reactions: { $sum: { $cond: [{ $eq: ["$type", "REACTION"] }, 1, 0] } } } }]),
    SeenEngagement.aggregate([{ $group: { _id: "$user", actions: { $sum: 1 }, comments: { $sum: { $cond: [{ $eq: ["$type", "COMMENT"] }, 1, 0] } }, reactions: { $sum: { $cond: [{ $eq: ["$type", "REACTION"] }, 1, 0] } } } }]),
    SavedItem.aggregate([{ $group: { _id: "$user", saves: { $sum: 1 }, actions: { $sum: 1 } } }]),
    ProfileRelationship.aggregate([{ $group: { _id: "$actor", follows: { $sum: 1 }, actions: { $sum: 1 } } }]),
    Message.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: "$sender", messages: { $sum: 1 }, actions: { $sum: 1 } } }]),
    FeedPost.aggregate([{ $unwind: "$comments" }, { $group: { _id: "$comments.user", comments: { $sum: 1 }, actions: { $sum: 1 } } }]),
  ]);
  const map = new Map();
  for (const collection of [wall, seen, saves, follows, messages, postComments]) {
    for (const row of collection) {
      const id = idString(row._id);
      const current = map.get(id) || { id, actions: 0, comments: 0, reactions: 0, saves: 0, follows: 0, messages: 0 };
      for (const key of ["actions", "comments", "reactions", "saves", "follows", "messages"]) current[key] += toNumber(row[key]);
      map.set(id, current);
    }
  }
  const sorted = [...map.values()].sort((a, b) => b.actions - a.actions).slice(0, limit);
  const users = await User.find({ _id: { $in: sorted.map((row) => row.id) } }).select("name username role avatar").lean();
  const userMap = new Map(users.map((user) => [idString(user._id), user]));
  return sorted.map((row) => ({ ...row, user: userMap.get(row.id) && { name: userMap.get(row.id).name, username: userMap.get(row.id).username, role: userMap.get(row.id).role, avatar: userMap.get(row.id).avatar } })).filter((row) => row.user);
}

async function activityByTime(startDate, endDate) {
  const [wallRows, analyticsRows] = await Promise.all([
    WallEngagement.aggregate([
      { $match: dateMatch("createdAt", startDate, endDate) },
      { $group: { _id: { hour: { $hour: { date: "$createdAt", timezone: "UTC" } }, day: { $dayOfWeek: { date: "$createdAt", timezone: "UTC" } } }, count: { $sum: 1 } } },
    ]),
    AnalyticsEvent.aggregate([
      { $match: dateMatch("createdAt", startDate, endDate) },
      { $group: { _id: { hour: { $hour: { date: "$createdAt", timezone: "UTC" } }, day: { $dayOfWeek: { date: "$createdAt", timezone: "UTC" } } }, count: { $sum: 1 } } },
    ]),
  ]);
  const hours = Array.from({ length: 24 }, (_, hour) => ({ label: `${String(hour).padStart(2, "0")}:00`, count: 0 }));
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => ({ label, count: 0 }));
  for (const row of [...wallRows, ...analyticsRows]) {
    hours[row._id.hour].count += row.count;
    days[row._id.day - 1].count += row.count;
  }
  return { hours, days };
}

export async function getAdminAnalytics(query = {}) {
  const range = parseAnalyticsRange(query);
  const buckets = buildBuckets(range.startDate, range.endDate, range.granularity);
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 10, 1), 50);

  const [
    totalUsers, fans, creators, admins, verifiedCreators, newUsers, previousNewUsers, activeUsers, previousActiveUsers,
    totalContent, publishedContent, postsCreated, publicationsCreated, storiesCreated, wallPostsCreated,
    accountRows, contentRows, publicationStatusRows, contentStatusRows, growth, creation, engagement, previousEngagement,
    trend, top, creatorsTable, activeTable, moderationRows, moderationTrend, subscriptions, memberships, transactions, time,
    sessions, retention, profiles, search, funnel,
  ] = await Promise.all([
    User.countDocuments({ deletionRequestedAt: null }),
    User.countDocuments({ role: "fan", deletionRequestedAt: null }),
    User.countDocuments({ role: { $in: ["fan", "creator"] }, creatorApprovalStatus: "approved", deletionRequestedAt: null }),
    User.countDocuments({ role: "admin", deletionRequestedAt: null }),
    User.countDocuments({ isVerified: true, creatorApprovalStatus: "approved", deletionRequestedAt: null }),
    countInRange(User, range.startDate, range.endDate, { deletionRequestedAt: null }),
    countInRange(User, range.previousStartDate, range.previousEndDate, { deletionRequestedAt: null }),
    distinctActivityUsers(range.startDate, range.endDate),
    distinctActivityUsers(range.previousStartDate, range.previousEndDate),
    Promise.all([Content.countDocuments(), Publication.countDocuments(), FeedPost.countDocuments({ deletedAt: null }), Story.countDocuments(), WallPost.countDocuments()]).then((items) => items.reduce((sum, value) => sum + value, 0)),
    Promise.all([Content.countDocuments({ status: { $in: ["PUBLISHED", "published"] } }), Publication.countDocuments({ status: "PUBLISHED" }), FeedPost.countDocuments({ status: "published", deletedAt: null }), WallPost.countDocuments({ status: "PUBLISHED" })]).then((items) => items.reduce((sum, value) => sum + value, 0)),
    countInRange(FeedPost, range.startDate, range.endDate, { deletedAt: null }),
    countInRange(Publication, range.startDate, range.endDate),
    countInRange(Story, range.startDate, range.endDate),
    countInRange(WallPost, range.startDate, range.endDate),
    distribution(User, "role", { deletionRequestedAt: null }),
    distribution(Publication, "kind"),
    distribution(Publication, "status"),
    distribution(Content, "status"),
    userGrowth(range, buckets),
    contentCreation(range, buckets),
    engagementSummary(range.startDate, range.endDate),
    engagementSummary(range.previousStartDate, range.previousEndDate),
    engagementTrend(range, buckets),
    topContent({ page, limit, sort: query.sort }),
    creatorPerformance({ limit: 10 }),
    mostActiveUsers({ limit: 10 }),
    MessageReport.aggregate([{ $match: dateMatch("createdAt", range.startDate, range.endDate) }, { $group: { _id: { scope: "$scope", status: "$status" }, count: { $sum: 1 } } }]),
    MessageReport.aggregate([{ $match: dateMatch("createdAt", range.startDate, range.endDate) }, { $group: { _id: dateToString(range.granularity, "$createdAt"), reports: { $sum: 1 } } }]),
    Subscription.countDocuments({ status: "active" }),
    PremiumMembership.countDocuments({ status: { $in: ["ACTIVE", "CANCEL_AT_PERIOD_END"] } }),
    Transaction.aggregate([{ $match: dateMatch("createdAt", range.startDate, range.endDate) }, { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: "$amount" } } }]),
    activityByTime(range.startDate, range.endDate),
    sessionAnalytics(range.startDate, range.endDate),
    retentionAnalytics(range.endDate),
    profileAnalytics(range.startDate, range.endDate),
    searchAnalytics(range.startDate, range.endDate, range.previousStartDate, range.previousEndDate),
    contentFunnelAnalytics(range.startDate, range.endDate),
  ]);

  const behavior = [
    { label: "Views", value: engagement.views },
    { label: "Reactions", value: engagement.reactions },
    { label: "Comments", value: engagement.comments },
    { label: "Saves", value: engagement.saves },
    { label: "Shares", value: engagement.shares },
    { label: "Follows", value: engagement.follows },
    { label: "Messages", value: engagement.messages },
  ].filter((item) => item.value > 0);

  const contentStatusMap = new Map();
  for (const row of [...publicationStatusRows, ...contentStatusRows]) contentStatusMap.set(normalizeStatus(row._id), toNumber(contentStatusMap.get(normalizeStatus(row._id))) + row.count);

  const moderation = {
    totals: moderationRows.reduce((acc, row) => {
      const scope = String(row._id.scope || "UNKNOWN").toLowerCase();
      const status = String(row._id.status || "UNKNOWN").toLowerCase();
      acc.total += row.count;
      acc.byScope[scope] = (acc.byScope[scope] || 0) + row.count;
      acc.byStatus[status] = (acc.byStatus[status] || 0) + row.count;
      return acc;
    }, { total: 0, byScope: {}, byStatus: {} }),
    trend: hydrateBuckets(buckets, moderationTrend, ["reports"]),
  };

  const fallbackFunnelViews = Math.max(toNumber(funnel.views), toNumber(engagement.views));
  const fallbackFunnelEngagements = Math.max(
    toNumber(funnel.engagements),
    toNumber(engagement.reactions) + toNumber(engagement.comments) + toNumber(engagement.saves) + toNumber(engagement.shares),
  );
  const fallbackFunnelFollows = Math.max(toNumber(funnel.follows), toNumber(engagement.follows));
  const dashboardFunnel = {
    ...funnel,
    views: fallbackFunnelViews,
    engagements: fallbackFunnelEngagements,
    follows: fallbackFunnelFollows,
    engagementRate: funnel.engagementRate ?? percent(fallbackFunnelEngagements, fallbackFunnelViews),
    saveRate: funnel.saveRate ?? percent(engagement.saves, fallbackFunnelViews),
    followConversion: funnel.followConversion ?? percent(fallbackFunnelFollows, fallbackFunnelViews),
    subscriptionConversion: funnel.subscriptionConversion ?? percent(toNumber(funnel.subscriptions) + toNumber(funnel.support), fallbackFunnelViews),
  };

  return {
    range: { startDate: range.startDate, endDate: range.endDate, granularity: range.granularity },
    supportedMetrics: {
      direct: ["users", "roles", "content statuses", "feed post views/reactions/comments/saves/shares", "seen/wall/story engagements", "follows", "messages", "reports", "subscriptions", "premium memberships", "transactions", "analytics sessions", "profile views", "search events", "content impressions"],
      derived: ["active users from persisted session and interaction timestamps", "cohort retention from analytics sessions", "engagement rates from impressions and stored actions"],
      unavailable: [],
      trackingStartDate: TRACKING_START_DATE,
      notice: `Advanced behavioral analytics tracking is enabled. Historical availability begins from ${TRACKING_START_DATE.toISOString().slice(0, 10)}.`,
    },
    summary: {
      totalUsers, newUsers, activeUsers, totalCreators: creators, verifiedCreators, totalFans: fans, admins,
      totalPublishedContent: publishedContent, totalContent, postsCreated, publicationsCreated, storiesCreated, wallPostsCreated,
      totalEngagements: engagement.total, engagementRate: engagement.engagementRate,
      comments: engagement.comments, reactions: engagement.reactions, saves: engagement.saves, follows: engagement.follows,
      activeSubscriptions: subscriptions, activePremiumMemberships: memberships, supportTransactions: toNumber(transactions[0]?.count), supportAmount: toNumber(transactions[0]?.amount),
      sessions: sessions.sessions, dau: sessions.dau, wau: sessions.wau, mau: sessions.mau, returningUsers: sessions.returningUsers, averageSessionDurationSeconds: sessions.averageSessionDurationSeconds,
      retentionDay1: retention.day1, retentionDay7: retention.day7, retentionDay30: retention.day30,
      profileViews: profiles.totalProfileViews, totalSearches: search.totalSearches, contentImpressions: dashboardFunnel.impressions, impressionViewRate: dashboardFunnel.viewRate,
    },
    changes: { newUsers: pct(newUsers, previousNewUsers), activeUsers: pct(activeUsers, previousActiveUsers), totalEngagements: pct(engagement.total, previousEngagement.total) },
    userGrowth: growth,
    accountDistribution: accountRows.map((row) => ({ label: row._id || "unknown", value: row.count })),
    userActivity: trend.map((row) => ({ ...row, activeUsers: row.engagements + row.messages })),
    userBehavior: behavior,
    contentCreation: creation,
    contentDistribution: [
      ...contentRows.map((row) => ({ label: row._id?.replaceAll("_", " ") || "Publication", value: row.count })),
      { label: "Feed posts", value: await FeedPost.countDocuments({ deletedAt: null }) },
      { label: "Stories", value: await Story.countDocuments() },
    ].filter((item) => item.value > 0),
    contentStatus: [...contentStatusMap.entries()].map(([label, value]) => ({ label, value })),
    engagement: { summary: engagement, trend },
    sessions,
    retention,
    profiles,
    search,
    funnel: dashboardFunnel,
    dataAvailability: {
      trackingStartDate: TRACKING_START_DATE,
      advancedTrackingAvailable: range.endDate >= TRACKING_START_DATE,
      noHistoricalTrackingData: range.endDate < TRACKING_START_DATE,
      message: range.endDate < TRACKING_START_DATE ? "No historical tracking data is available for this period." : `Advanced behavioral analytics tracking is enabled. Historical availability begins from ${TRACKING_START_DATE.toISOString().slice(0, 10)}.`,
    },
    topContent: top,
    creatorPerformance: creatorsTable,
    mostActiveUsers: activeTable,
    moderation,
    platformActivity: time,
    filters: { contentTypes: SUPPORTED_CONTENT_TYPES, statuses: SUPPORTED_STATUSES, accountTypes: ["all", "fan", "creator", "admin"] },
  };
}

export async function exportAdminAnalytics(query = {}) {
  const report = await getAdminAnalytics({ ...query, limit: 50 });
  const format = String(query.format || "json").toLowerCase();
  if (format === "csv") {
    const rows = [
      ["section", "label", "value"],
      ...Object.entries(report.summary).map(([key, value]) => ["summary", key, value ?? ""]),
      ...report.accountDistribution.map((item) => ["account_distribution", item.label, item.value]),
      ...report.userBehavior.map((item) => ["user_behavior", item.label, item.value]),
      ...report.contentStatus.map((item) => ["content_status", item.label, item.value]),
      ...report.topContent.items.map((item) => ["top_content", item.title, item.engagement]),
      ...report.creatorPerformance.map((item) => ["creator_performance", item.creator.username, item.engagement]),
    ];
    return rows.map((row) => row.map((cell) => `"${String(cell).replaceAll("\"", "\"\"")}"`).join(",")).join("\n");
  }
  if (format === "pdf") return buildAnalyticsPdf(report);
  return report;
}

function pdfEscape(value) {
  return String(value).replace(/[^\u0020-\u007E]/g, " ").replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function wrapLine(text, max = 62) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (`${line} ${word}`.trim().length > max) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = `${line} ${word}`.trim();
    }
  }
  if (line) lines.push(line);
  return lines;
}

function rgb(hex) {
  const clean = hex.replace("#", "");
  return [0, 2, 4].map((index) => Number.parseInt(clean.slice(index, index + 2), 16) / 255);
}

function color(hex, stroke = false) {
  const [r, g, b] = rgb(hex);
  return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} ${stroke ? "RG" : "rg"}`;
}

function textCommand(text, x, y, size = 10, fill = "#0f172a") {
  return `BT\n${color(fill)}\n/F1 ${size} Tf\n1 0 0 1 ${x} ${y} Tm\n(${pdfEscape(text)}) Tj\nET`;
}

function rectCommand(x, y, width, height, fill, stroke = null) {
  const paint = stroke ? "B" : "f";
  return `q\n${color(fill)}\n${stroke ? color(stroke, true) : ""}\n${x} ${y} ${width} ${height} re\n${paint}\nQ`;
}

function lineCommand(x1, y1, x2, y2, stroke = "#cbd5e1", width = 1) {
  return `q\n${color(stroke, true)}\n${width} w\n${x1} ${y1} m\n${x2} ${y2} l\nS\nQ`;
}

function polygonCommand(points, fill) {
  if (points.length < 3) return "";
  const [first, ...rest] = points;
  return `q\n${color(fill)}\n${first[0].toFixed(2)} ${first[1].toFixed(2)} m\n${rest.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)} l`).join("\n")}\nh\nf\nQ`;
}

function drawHeader(commands, report, pageTitle = "Reports & Analytics") {
  commands.push(rectCommand(0, 735, 612, 57, "#fff7ed"));
  commands.push(rectCommand(40, 748, 34, 30, "#f97316"));
  commands.push(textCommand("O", 52, 758, 15, "#ffffff"));
  commands.push(textCommand("OnlyMe", 86, 765, 16, "#0f172a"));
  commands.push(textCommand(pageTitle, 86, 748, 10, "#64748b"));
  commands.push(textCommand(`${new Date(report.range.startDate).toISOString().slice(0, 10)} to ${new Date(report.range.endDate).toISOString().slice(0, 10)} | ${report.range.granularity}`, 365, 760, 9, "#475569"));
}

function drawSectionTitle(commands, title, x, y, subtitle = "") {
  commands.push(textCommand(title, x, y, 14, "#0f172a"));
  if (subtitle) commands.push(textCommand(subtitle, x, y - 14, 8, "#64748b"));
}

function drawKpi(commands, item, x, y, width, accent) {
  commands.push(rectCommand(x, y, width, 72, "#ffffff", "#e2e8f0"));
  commands.push(rectCommand(x, y + 68, width, 4, accent));
  commands.push(textCommand(item.label, x + 12, y + 48, 8, "#64748b"));
  commands.push(textCommand(item.value, x + 12, y + 25, 18, "#0f172a"));
  if (item.detail) commands.push(textCommand(item.detail, x + 12, y + 10, 8, "#64748b"));
}

function drawLineChart(commands, rows, series, x, y, width, height) {
  const max = Math.max(1, ...rows.flatMap((row) => series.map((item) => toNumber(row[item.key]))));
  commands.push(rectCommand(x, y, width, height, "#ffffff", "#e2e8f0"));
  for (let tick = 1; tick < 4; tick += 1) commands.push(lineCommand(x + 16, y + tick * (height / 4), x + width - 16, y + tick * (height / 4), "#f1f5f9", 0.5));
  commands.push(lineCommand(x + 16, y + 18, x + width - 16, y + 18, "#cbd5e1", 0.8));
  series.forEach((item, seriesIndex) => {
    const points = rows.map((row, index) => {
      const px = x + 18 + (index / Math.max(1, rows.length - 1)) * (width - 36);
      const py = y + 22 + (toNumber(row[item.key]) / max) * (height - 46);
      return [px, py];
    });
    if (points.length > 1) {
      commands.push(`q\n${color(item.color, true)}\n2 w\n${points.map(([px, py], index) => `${px.toFixed(2)} ${py.toFixed(2)} ${index ? "l" : "m"}`).join("\n")}\nS\nQ`);
    }
    commands.push(rectCommand(x + 16 + seriesIndex * 90, y + height - 16, 8, 8, item.color));
    commands.push(textCommand(item.label, x + 28 + seriesIndex * 90, y + height - 15, 7, "#475569"));
  });
}

function drawBarChart(commands, rows, x, y, width, height, valueKey = "value") {
  const values = rows.slice(0, 8);
  const max = Math.max(1, ...values.map((item) => toNumber(item[valueKey])));
  commands.push(rectCommand(x, y, width, height, "#ffffff", "#e2e8f0"));
  values.forEach((item, index) => {
    const barY = y + height - 28 - index * 20;
    const barWidth = (toNumber(item[valueKey]) / max) * (width - 135);
    commands.push(textCommand(String(item.label).slice(0, 18), x + 12, barY + 3, 7, "#475569"));
    commands.push(rectCommand(x + 105, barY, width - 125, 10, "#f1f5f9"));
    commands.push(rectCommand(x + 105, barY, Math.max(2, barWidth), 10, PDF_COLORS[index % PDF_COLORS.length]));
    commands.push(textCommand(formatReportValue(item[valueKey]), x + width - 35, barY + 2, 7, "#0f172a"));
  });
}

function drawPieChart(commands, rows, x, y, radius) {
  const total = rows.reduce((sum, item) => sum + toNumber(item.value), 0);
  if (!total) {
    commands.push(textCommand("No chart data available", x - radius, y, 9, "#64748b"));
    return;
  }
  let angle = -Math.PI / 2;
  rows.slice(0, 6).forEach((item, index) => {
    const slice = (toNumber(item.value) / total) * Math.PI * 2;
    const steps = Math.max(4, Math.ceil(slice / 0.25));
    const points = [[x, y]];
    for (let step = 0; step <= steps; step += 1) {
      const current = angle + (slice * step) / steps;
      points.push([x + Math.cos(current) * radius, y + Math.sin(current) * radius]);
    }
    commands.push(polygonCommand(points, PDF_COLORS[index % PDF_COLORS.length]));
    commands.push(rectCommand(x + radius + 22, y + radius - 14 - index * 18, 8, 8, PDF_COLORS[index % PDF_COLORS.length]));
    commands.push(textCommand(`${String(item.label).slice(0, 16)} ${Math.round((toNumber(item.value) / total) * 100)}%`, x + radius + 35, y + radius - 14 - index * 18, 7, "#475569"));
    angle += slice;
  });
  commands.push(polygonCommand(Array.from({ length: 28 }, (_, index) => {
    const current = (Math.PI * 2 * index) / 28;
    return [x + Math.cos(current) * (radius * 0.48), y + Math.sin(current) * (radius * 0.48)];
  }), "#ffffff"));
  commands.push(textCommand(formatReportValue(total), x - 15, y - 3, 11, "#0f172a"));
}

function drawTable(commands, title, rows, columns, x, y, width) {
  drawSectionTitle(commands, title, x, y + 18);
  commands.push(rectCommand(x, y - 4, width, 22, "#f8fafc", "#e2e8f0"));
  let cursorX = x + 8;
  columns.forEach((column) => {
    commands.push(textCommand(column.label, cursorX, y + 4, 7, "#64748b"));
    cursorX += column.width;
  });
  rows.slice(0, 8).forEach((row, rowIndex) => {
    const rowY = y - 25 - rowIndex * 21;
    commands.push(lineCommand(x, rowY + 17, x + width, rowY + 17, "#f1f5f9", 0.4));
    let cellX = x + 8;
    columns.forEach((column) => {
      commands.push(textCommand(String(column.value(row)).slice(0, column.max || 28), cellX, rowY + 5, 7, "#334155"));
      cellX += column.width;
    });
  });
}

function assemblePdf(pageStreams) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };

  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds = [];

  for (const pageCommands of pageStreams) {
    const stream = pageCommands.join("\n");
    const contentId = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent 0 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`));
  }

  const pagesId = add(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  for (const id of pageIds) objects[id - 1] = objects[id - 1].replace("/Parent 0 0 R", `/Parent ${pagesId} 0 R`);
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  const chunks = ["%PDF-1.4\n"];
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(chunks.join("")));
    chunks.push(`${index + 1} 0 obj\n${objects[index]}\nendobj\n`);
  }
  const xrefOffset = Buffer.byteLength(chunks.join(""));
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (let index = 1; index < offsets.length; index += 1) chunks.push(`${String(offsets[index]).padStart(10, "0")} 00000 n \n`);
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return Buffer.from(chunks.join(""), "utf8");
}

export function buildAnalyticsPdf(report) {
  const pages = [[], [], []];
  pages.forEach((commands, index) => drawHeader(commands, report, index === 0 ? "Executive analytics report" : `Analytics detail ${index + 1}`));

  const summary = report.summary;
  pages[0].push(textCommand("Reports & Analytics", 40, 705, 24, "#0f172a"));
  pages[0].push(textCommand("User activity, content performance, engagement, growth, safety, and support.", 40, 686, 10, "#64748b"));
  [
    { label: "Total Users", value: summary.totalUsers, detail: `${summary.newUsers} new in range` },
    { label: "Active Users", value: summary.activeUsers, detail: "last seen + interactions" },
    { label: "Creators", value: summary.totalCreators, detail: `${summary.verifiedCreators} verified` },
    { label: "Published Content", value: summary.totalPublishedContent, detail: `${summary.postsCreated} posts created` },
    { label: "Engagements", value: summary.totalEngagements, detail: `${summary.engagementRate ?? "N/A"}% rate` },
    { label: "Subscriptions", value: summary.activeSubscriptions, detail: `${summary.activePremiumMemberships} premium` },
  ].forEach((item, index) => drawKpi(pages[0], { ...item, value: formatReportValue(item.value) }, 40 + (index % 3) * 178, 592 - Math.floor(index / 3) * 88, 160, PDF_COLORS[index % PDF_COLORS.length]));

  drawSectionTitle(pages[0], "User Growth", 40, 500, "Registrations by role across the selected period.");
  drawLineChart(pages[0], report.userGrowth, [{ key: "total", label: "Total", color: "#f97316" }, { key: "fans", label: "Fans", color: "#2563eb" }, { key: "creators", label: "Creators", color: "#10b981" }], 40, 294, 325, 180);
  drawSectionTitle(pages[0], "Account Distribution", 392, 500, "Current account mix.");
  drawPieChart(pages[0], report.accountDistribution, 445, 380, 52);
  drawSectionTitle(pages[0], "User Behavior", 40, 250, "Measured actions from persisted product data.");
  drawBarChart(pages[0], report.userBehavior, 40, 75, 520, 150);

  drawSectionTitle(pages[1], "Content Creation", 40, 700, "Posts, Seens, Worlds, Stories and legacy content created over time.");
  drawLineChart(pages[1], report.contentCreation, [{ key: "feedPosts", label: "Posts", color: "#f97316" }, { key: "seens", label: "Seens", color: "#2563eb" }, { key: "worlds", label: "Worlds", color: "#8b5cf6" }, { key: "stories", label: "Stories", color: "#10b981" }], 40, 492, 520, 180);
  drawSectionTitle(pages[1], "Content Distribution", 40, 445, "Supported content types.");
  drawPieChart(pages[1], report.contentDistribution, 105, 345, 55);
  drawSectionTitle(pages[1], "Content Status", 300, 445, "Moderation and lifecycle statuses.");
  drawBarChart(pages[1], report.contentStatus, 300, 265, 260, 150);
  drawSectionTitle(pages[1], "Engagement Overview", 40, 225, "Engagement, messages, and reports trend.");
  drawLineChart(pages[1], report.engagement.trend, [{ key: "engagements", label: "Engagements", color: "#f97316" }, { key: "messages", label: "Messages", color: "#2563eb" }, { key: "reports", label: "Reports", color: "#ef4444" }], 40, 40, 520, 160);

  drawTable(pages[2], "Top Performing Content", report.topContent.items, [
    { label: "Content", width: 220, max: 34, value: (row) => row.title },
    { label: "Creator", width: 110, max: 16, value: (row) => row.creator?.username ? `@${row.creator.username}` : "unknown" },
    { label: "Type", width: 75, max: 12, value: (row) => row.type },
    { label: "Views", width: 55, value: (row) => formatReportValue(row.views) },
    { label: "Eng.", width: 55, value: (row) => formatReportValue(row.engagement) },
  ], 40, 672, 520);
  drawTable(pages[2], "Creator Performance", report.creatorPerformance, [
    { label: "Creator", width: 180, max: 26, value: (row) => `@${row.creator.username}` },
    { label: "Content", width: 85, value: (row) => formatReportValue(row.content) },
    { label: "Views", width: 80, value: (row) => formatReportValue(row.views) },
    { label: "Followers", width: 85, value: (row) => formatReportValue(row.followers) },
    { label: "Eng.", width: 65, value: (row) => formatReportValue(row.engagement) },
  ], 40, 452, 520);
  drawSectionTitle(pages[2], "Safety & Moderation", 40, 250, "Reports submitted in the selected period.");
  drawBarChart(pages[2], Object.entries(report.moderation.totals.byScope).map(([label, value]) => ({ label, value })), 40, 95, 245, 130);
  drawSectionTitle(pages[2], "Platform Activity", 315, 250, "Engagement activity by UTC hour.");
  drawBarChart(pages[2], report.platformActivity.hours.filter((item) => item.count > 0).slice(0, 8), 315, 95, 245, 130, "count");
  drawSectionTitle(pages[2], "Data Coverage Notes", 40, 60);
  wrapLine(report.dataAvailability?.message || report.supportedMetrics?.notice || "Advanced behavioral analytics tracking is enabled.", 100).slice(0, 2).forEach((line, index) => pages[2].push(textCommand(line, 40, 42 - index * 12, 8, "#64748b")));

  pages.forEach((commands, index) => commands.push(textCommand(`Page ${index + 1} of ${pages.length}`, 520, 24, 8, "#94a3b8")));
  return assemblePdf(pages);
}
