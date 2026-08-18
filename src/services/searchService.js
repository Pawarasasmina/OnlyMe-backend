import mongoose from "mongoose";
import Content from "../models/Content.js";
import CreatorProfile from "../models/CreatorProfile.js";
import FanProfile from "../models/FanProfile.js";
import FeedPost from "../models/FeedPost.js";
import OrbitCityProgress from "../models/OrbitCityProgress.js";
import OrbitDream from "../models/OrbitDream.js";
import SearchHistory from "../models/SearchHistory.js";
import User from "../models/User.js";
import UserBlock from "../models/UserBlock.js";
import ApiError from "../utils/ApiError.js";

export const SEARCH_TYPES = ["all", "people", "worlds", "seens", "posts", "places", "journeys", "saved"];
export const SEARCH_SORTS = ["relevant", "newest", "most_saved"];
export const PRODUCT_TRENDS = ["Fitness", "Paris", "Business", "Mindset", "Tokyo style"];
export const DEFAULT_CATEGORIES = [
  "Fitness",
  "Lifestyle",
  "Business",
  "Psychology",
  "Fashion",
  "Travel",
  "Beauty",
  "Books",
  "Family",
  "Technology",
  "Food",
  "Photography",
  "Music",
  "Sports",
  "Entrepreneurship",
  "Culture",
];

const ALL_PREVIEW_LIMITS = {
  people: 4,
  worlds: 4,
  seens: 3,
  posts: 3,
  places: 4,
  journeys: 3,
  saved: 3,
};
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 30;
const PUBLIC_CONTENT_STATUSES = ["PUBLISHED", "published"];

function cleanText(value, maxLength = 100) {
  return String(value || "").replace(/\s+/gu, " ").trim().slice(0, maxLength);
}

function normalizeQuery(value) {
  return cleanText(value, 100);
}

function normalizedKey(value) {
  return normalizeQuery(value).toLocaleLowerCase();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function regexFor(query) {
  return new RegExp(escapeRegex(query), "iu");
}

function parseLimit(value, fallback = DEFAULT_LIMIT) {
  const limit = Number(value) || fallback;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

function parseCursor(value) {
  if (!value) return 0;
  const offset = Number(value);
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ApiError(400, "Invalid cursor");
  }
  return offset;
}

function readType(value = "all") {
  const type = cleanText(value, 20).toLowerCase() || "all";
  if (!SEARCH_TYPES.includes(type)) throw new ApiError(400, "Unsupported search type");
  return type;
}

function readSort(value = "relevant") {
  const sort = cleanText(value, 20).toLowerCase() || "relevant";
  if (!SEARCH_SORTS.includes(sort)) throw new ApiError(400, "Unsupported search sort");
  return sort;
}

function queryOr(query, fields) {
  const term = regexFor(query);
  return fields.map((field) => ({ [field]: term }));
}

function objectIdList(values) {
  return Array.from(values).filter(mongoose.isValidObjectId).map((id) => new mongoose.Types.ObjectId(id));
}

function mediaUrl(content) {
  const primary = content.thumbnail || (content.media || []).find((item) => item.isPrimary) || (content.media || [])[0] || (content.images || []).find((item) => item.isMain) || (content.images || [])[0];
  return primary?.secureUrl || primary?.url || "";
}

function contentCreator(content) {
  const creator = content.creator || {};
  return {
    id: String(creator._id || creator.id || ""),
    name: creator.name || "Creator",
    username: creator.username || "",
    avatar: creator.avatar || "",
    verified: Boolean(creator.isVerified),
  };
}

function publicLocation(city, country) {
  return {
    city: cleanText(city, 80),
    country: cleanText(country, 80),
  };
}

async function blockedIdsFor(userId) {
  const blocks = await UserBlock.find({ $or: [{ blocker: userId }, { blocked: userId }] }).select("blocker blocked").lean();
  return new Set(blocks.map((block) => String(block.blocker) === String(userId) ? String(block.blocked) : String(block.blocker)));
}

function baseSort(sort) {
  if (sort === "newest") return { publishedAt: -1, createdAt: -1, _id: -1 };
  if (sort === "most_saved") return { saveCount: -1, publishedAt: -1, createdAt: -1 };
  return { publishedAt: -1, createdAt: -1, _id: -1 };
}

function resultPage(items, offset, limit, total = items.length) {
  const nextOffset = offset + items.length;
  return {
    items,
    total,
    nextCursor: nextOffset < total ? String(nextOffset) : null,
  };
}

function scoreText(query, values = []) {
  const needle = normalizedKey(query).replace(/^@/u, "");
  let score = 0;
  for (const raw of values) {
    const value = normalizedKey(raw).replace(/^@/u, "");
    if (!value) continue;
    if (value === needle) score += 80;
    else if (value.startsWith(needle)) score += 45;
    else if (value.includes(needle)) score += 15;
  }
  return score;
}

function serializePerson({ profile, user, query }) {
  const creatorEnabled = user.creatorApprovalStatus === "approved";
  const categories = creatorEnabled
    ? [...new Set([...(profile.categories || []), profile.category].filter(Boolean))]
    : profile.interests || [];
  const location = profile.privacySettings?.showLocation === false ? publicLocation("", "") : publicLocation(profile.city, profile.country);
  const title = user.name || user.username;
  const subtitleParts = [`@${user.username}`];
  if (creatorEnabled && (profile.category || categories[0])) subtitleParts.push(profile.category || categories[0]);
  if (location.city || location.country) subtitleParts.push([location.city, location.country].filter(Boolean).join(", "));

  return {
    id: String(user._id),
    type: "person",
    title,
    subtitle: subtitleParts.join(" - "),
    description: cleanText(profile.orbitQuote || profile.bio || profile.orbitStatus, 220),
    image: user.avatar || "",
    route: `/profile/${encodeURIComponent(user.username)}`,
    verified: Boolean(user.isVerified),
    category: profile.category || categories[0] || "",
    location,
    metadata: {
      role: creatorEnabled ? "creator" : "fan",
      username: user.username,
      profileCategory: profile.category || categories[0] || "",
      orbitStatus: cleanText(profile.orbitStatus, 80),
      matchReason: query ? "Matched public profile fields" : "",
      canSeeYou: String(user._id) !== String(profile.user),
    },
    saved: false,
    createdAt: user.createdAt,
  };
}

async function searchPeople({ blockedIds, category, cursor = 0, limit, location, query, sort, user }) {
  const blockedObjectIds = objectIdList(blockedIds);
  const escaped = query ? regexFor(query.replace(/^@/u, "")) : null;
  const userMatch = {
    _id: { $nin: [user._id, ...blockedObjectIds] },
    role: { $in: ["fan", "creator"] },
    status: "active",
  };
  const matchingUserIds = query
    ? await User.find({
        ...userMatch,
        $or: [{ name: escaped }, { username: escaped }],
      }).select("_id").limit(200).lean()
    : [];
  const profileTextOr = queryOr(query || " ", ["bio", "orbitQuote", "orbitStatus", "city", "country", "category", "categories", "interests"]);
  const commonProfileFilter = {
    "privacySettings.allowDiscovery": { $ne: false },
    ...(category ? { $or: [{ category: regexFor(category) }, { categories: regexFor(category) }, { interests: regexFor(category) }] } : {}),
    ...(location ? { $or: [{ city: regexFor(location) }, { country: regexFor(location) }] } : {}),
  };
  const profileQuery = query
    ? { ...commonProfileFilter, $or: [{ user: { $in: matchingUserIds.map((item) => item._id) } }, ...profileTextOr] }
    : commonProfileFilter;

  const [creatorProfiles, fanProfiles] = await Promise.all([
    CreatorProfile.find(profileQuery).populate({ path: "user", match: { ...userMatch, role: { $in: ["fan", "creator"] }, creatorApprovalStatus: "approved" }, select: "name username avatar isVerified role status creatorApprovalStatus createdAt" }).limit(300).lean(),
    FanProfile.find(profileQuery).populate({ path: "user", match: { ...userMatch, creatorApprovalStatus: { $ne: "approved" } }, select: "name username avatar isVerified role status creatorApprovalStatus createdAt" }).limit(300).lean(),
  ]);

  const scored = [...creatorProfiles, ...fanProfiles]
    .filter((profile) => profile.user)
    .map((profile) => ({
      item: serializePerson({ profile, query, user: profile.user }),
      score: scoreText(query, [profile.user.username, profile.user.name, profile.category, ...(profile.categories || []), ...(profile.interests || []), profile.city, profile.country, profile.bio]),
    }))
    .sort((left, right) => sort === "newest"
      ? new Date(right.item.createdAt || 0) - new Date(left.item.createdAt || 0)
      : right.score - left.score || left.item.title.localeCompare(right.item.title));

  return resultPage(scored.slice(cursor, cursor + limit).map((entry) => entry.item), cursor, limit, scored.length);
}

function serializeContentResult(content, type, query) {
  const creator = contentCreator(content);
  const publicSnippet = content.accessLevel === "PUBLIC" ? cleanText(content.description || content.body, 220) : cleanText(content.description, 180);
  return {
    id: String(content._id),
    type,
    title: content.title,
    subtitle: [creator.name, content.category].filter(Boolean).join(" - "),
    description: publicSnippet,
    image: mediaUrl(content),
    route: type === "seen" ? `/seen/${String(content._id)}` : `/worlds/${String(content._id)}`,
    verified: creator.verified,
    category: content.category || "",
    location: publicLocation("", ""),
    metadata: {
      creator,
      accessLevel: content.accessLevel,
      free: content.accessLevel === "PUBLIC",
      price: content.accessLevel === "PAY_PER_VIEW" ? content.coinPrice : null,
      matchReason: query ? "Matched public content fields" : "",
    },
    saved: false,
    createdAt: content.publishedAt || content.createdAt,
  };
}

async function eligibleCreatorIds(blockedIds) {
  const blockedObjectIds = objectIdList(blockedIds);
  const users = await User.find({
    _id: { $nin: blockedObjectIds },
    role: { $in: ["fan", "creator"] },
    status: "active",
    creatorApprovalStatus: "approved",
  }).select("_id").lean();
  return users.map((item) => item._id);
}

async function searchContent({ blockedIds, category, cursor = 0, limit, location, query, sort, type }) {
  const creatorIds = await eligibleCreatorIds(blockedIds);
  const filter = {
    creator: { $in: creatorIds },
    status: { $in: PUBLIC_CONTENT_STATUSES },
    archivedAt: null,
  };
  if (category) filter.category = regexFor(category);
  if (query) {
    filter.$or = queryOr(query, ["title", "description", "category", "tags", "topic"]);
    if (type === "seen") filter.$or.push({ contentType: regexFor("TEXT") });
  }
  if (location) {
    filter.$or = [...(filter.$or || []), ...queryOr(location, ["description", "category", "tags", "topic"])];
  }
  const [records, total] = await Promise.all([
    Content.find(filter)
      .sort(baseSort(sort))
      .skip(cursor)
      .limit(limit)
      .populate("creator", "name username avatar isVerified role status creatorApprovalStatus")
      .lean(),
    Content.countDocuments(filter),
  ]);

  return resultPage(records.map((item) => serializeContentResult(item, type === "seen" ? "seen" : "world", query)), cursor, limit, total);
}

function serializePost(post, query) {
  const author = post.author || {};
  const thumbnail = (post.media || [])[0]?.url || "";
  return {
    id: String(post._id),
    type: "post",
    title: cleanText(post.text, 90) || "Home post",
    subtitle: [author.name, post.context].filter(Boolean).join(" - "),
    description: cleanText(post.text, 220),
    image: thumbnail,
    route: `/wall?post=${String(post._id)}`,
    verified: Boolean(author.isVerified),
    category: post.context || "",
    location: publicLocation(post.location, ""),
    metadata: {
      author: { id: String(author._id || ""), name: author.name || "", username: author.username || "", avatar: author.avatar || "" },
      reactionCount: (post.reactions || []).length || post.supportCount || 0,
      commentCount: (post.comments || []).filter((comment) => !comment.deletedAt).length || post.commentCount || 0,
      saveCount: post.saveCount || 0,
      matchReason: query ? "Matched public post fields" : "",
    },
    saved: false,
    createdAt: post.publishedAt || post.createdAt,
  };
}

async function searchPosts({ blockedIds, category, cursor = 0, limit, location, query, sort }) {
  const blockedObjectIds = objectIdList(blockedIds);
  const authors = await User.find({ _id: { $nin: blockedObjectIds }, status: "active", role: { $in: ["fan", "creator"] } }).select("_id").lean();
  const filter = {
    author: { $in: authors.map((item) => item._id) },
    status: "published",
    visibility: "public",
    deletedAt: null,
  };
  if (query) filter.$or = queryOr(query, ["text", "context", "location"]);
  if (category) filter.context = regexFor(category);
  if (location) filter.location = regexFor(location);
  const [records, total] = await Promise.all([
    FeedPost.find(filter).sort(baseSort(sort)).skip(cursor).limit(limit).populate("author", "name username avatar isVerified role status").lean(),
    FeedPost.countDocuments(filter),
  ]);
  return resultPage(records.map((item) => serializePost(item, query)), cursor, limit, total);
}

function placeKey(city, country = "") {
  return `${normalizedKey(city)}|${normalizedKey(country)}`;
}

function serializePlace({ category = "Place", city, count, country, image = "", topCreator = "" }) {
  const slug = encodeURIComponent([city, country].filter(Boolean).join("-").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  return {
    id: placeKey(city, country),
    type: "place",
    title: city,
    subtitle: [country, category].filter(Boolean).join(" - "),
    description: count ? `${count} public item${count === 1 ? "" : "s"} connected here` : "City-level discovery",
    image,
    route: `/search?type=worlds&location=${encodeURIComponent(city)}`,
    verified: false,
    category,
    location: publicLocation(city, country),
    metadata: { slug, relatedCount: count || 0, topCreator },
    saved: false,
    createdAt: null,
  };
}

async function searchPlaces({ blockedIds, category, cursor = 0, limit, location, query }) {
  const matcher = normalizedKey(query || location || category);
  const blockedObjectIds = objectIdList(blockedIds);
  const [cities, creatorProfiles, posts] = await Promise.all([
    OrbitCityProgress.find({ enabled: true }).sort({ sortOrder: 1, currentCount: -1 }).limit(100).lean(),
    CreatorProfile.find({
      profileVisibility: "public",
      "privacySettings.allowDiscovery": { $ne: false },
      "privacySettings.showLocation": { $ne: false },
      city: { $ne: "" },
    }).populate({ path: "user", match: { _id: { $nin: blockedObjectIds }, role: { $in: ["fan", "creator"] }, status: "active", creatorApprovalStatus: "approved" }, select: "name username avatar isVerified" }).limit(200).lean(),
    FeedPost.find({ status: "published", visibility: "public", deletedAt: null, location: { $ne: "" } }).select("location").limit(200).lean(),
  ]);

  const places = new Map();
  for (const city of cities) {
    const key = placeKey(city.city, city.country);
    places.set(key, serializePlace({ category: "Places", city: city.city, count: city.currentCount, country: city.country, topCreator: "@seen" }));
  }
  for (const profile of creatorProfiles) {
    if (!profile.user || !profile.city) continue;
    const key = placeKey(profile.city, profile.country);
    const existing = places.get(key);
    places.set(key, serializePlace({ category: profile.category || "Creator place", city: profile.city, count: (existing?.metadata?.relatedCount || 0) + 1, country: profile.country, image: profile.coverPhoto, topCreator: profile.user.username }));
  }
  for (const post of posts) {
    const [city, country = ""] = String(post.location || "").split(",").map((part) => part.trim());
    if (!city) continue;
    const key = placeKey(city, country);
    const existing = places.get(key);
    places.set(key, serializePlace({ category: "Post place", city, count: (existing?.metadata?.relatedCount || 0) + 1, country }));
  }

  const items = Array.from(places.values())
    .filter((item) => !matcher || normalizedKey([item.title, item.subtitle, item.category].join(" ")).includes(matcher))
    .sort((left, right) => (right.metadata.relatedCount || 0) - (left.metadata.relatedCount || 0) || left.title.localeCompare(right.title));
  return resultPage(items.slice(cursor, cursor + limit), cursor, limit, items.length);
}

function serializeJourney(dream) {
  const user = dream.user || {};
  return {
    id: String(dream._id),
    type: "journey",
    title: dream.title,
    subtitle: [user.name, dream.status].filter(Boolean).join(" - "),
    description: "Public creator journey",
    image: user.avatar || "",
    route: user.username ? `/profile/${encodeURIComponent(user.username)}` : "/orbit",
    verified: Boolean(user.isVerified),
    category: "Journey",
    location: publicLocation("", ""),
    metadata: {
      icon: dream.emoji || "",
      status: dream.status,
      supporterCount: dream.supporterCount || 0,
      source: "OrbitDream",
    },
    saved: false,
    createdAt: dream.updatedAt || dream.createdAt,
  };
}

async function searchJourneys({ blockedIds, cursor = 0, limit, query, sort }) {
  const blockedObjectIds = objectIdList(blockedIds);
  const filter = {
    visibility: "public",
    status: { $in: ["active", "completed"] },
  };
  if (query) filter.title = regexFor(query);
  const [records, total] = await Promise.all([
    OrbitDream.find(filter)
      .sort(sort === "newest" ? { updatedAt: -1 } : { supporterCount: -1, updatedAt: -1 })
      .skip(cursor)
      .limit(limit)
      .populate({ path: "user", match: { _id: { $nin: blockedObjectIds }, role: { $in: ["fan", "creator"] }, status: "active", creatorApprovalStatus: "approved" }, select: "name username avatar isVerified" })
      .lean(),
    OrbitDream.countDocuments(filter),
  ]);
  const items = records.filter((item) => item.user).map(serializeJourney);
  return resultPage(items, cursor, limit, total);
}

async function searchSaved({ cursor = 0, limit }) {
  return resultPage([], cursor, limit, 0);
}

export function readSearchParams(query = {}) {
  const q = normalizeQuery(query.q);
  if (q.length > 100) throw new ApiError(400, "Search query is too long");
  return {
    q,
    type: readType(query.type),
    category: cleanText(query.category, 40),
    location: cleanText(query.location, 80),
    sort: readSort(query.sort),
    limit: parseLimit(query.limit),
    cursor: parseCursor(query.cursor),
  };
}

export async function recordRecentSearch({ q, type, userId }) {
  const query = normalizeQuery(q);
  if (query.length < 2 || looksSensitive(query)) return null;
  const normalizedQuery = normalizedKey(query);
  const selectedType = readType(type);
  const record = await SearchHistory.findOneAndUpdate(
    { user: userId, normalizedQuery, selectedType },
    { $set: { query, lastUsedAt: new Date() }, $inc: { useCount: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  const stale = await SearchHistory.find({ user: userId }).sort({ lastUsedAt: -1 }).skip(20).select("_id").lean();
  if (stale.length) await SearchHistory.deleteMany({ _id: { $in: stale.map((item) => item._id) } });
  return serializeRecent(record);
}

function looksSensitive(query) {
  return /@.+\.[a-z]{2,}/iu.test(query) || /\+?\d[\d\s().-]{6,}\d/u.test(query) || /(token|password|secret|bearer)\s+/iu.test(query);
}

function serializeRecent(item) {
  return {
    id: String(item._id),
    query: item.query,
    normalizedQuery: item.normalizedQuery,
    selectedType: item.selectedType,
    useCount: item.useCount,
    lastUsedAt: item.lastUsedAt,
  };
}

export async function getRecentSearches(userId, limit = 10) {
  const records = await SearchHistory.find({ user: userId }).sort({ lastUsedAt: -1 }).limit(Math.min(20, Math.max(1, Number(limit) || 10))).lean();
  return records.map(serializeRecent);
}

export async function removeRecentSearch({ id, userId }) {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(400, "Invalid recent search ID");
  await SearchHistory.deleteOne({ _id: id, user: userId });
}

export async function clearRecentSearches(userId) {
  await SearchHistory.deleteMany({ user: userId });
}

export async function getTrendingSearches({ limit = 8 } = {}) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const aggregated = await SearchHistory.aggregate([
    { $match: { lastUsedAt: { $gte: since }, normalizedQuery: { $nin: PRODUCT_TRENDS.map(normalizedKey) } } },
    { $group: { _id: "$normalizedQuery", label: { $first: "$query" }, uses: { $sum: "$useCount" }, users: { $addToSet: "$user" } } },
    { $project: { label: 1, uses: 1, uniqueUsers: { $size: "$users" } } },
    { $match: { uniqueUsers: { $gte: 2 }, uses: { $gte: 3 } } },
    { $sort: { uses: -1, uniqueUsers: -1, label: 1 } },
    { $limit: Math.min(20, Math.max(1, Number(limit) || 8)) },
  ]);
  const live = aggregated.map((item) => ({ label: item.label, source: "history", useCount: item.uses }));
  if (live.length) return live;
  return PRODUCT_TRENDS.slice(0, limit).map((label) => ({ label, source: "configured" }));
}

export async function getSearchDefaults(user) {
  const [trending, recent] = await Promise.all([
    getTrendingSearches({ limit: 8 }),
    getRecentSearches(user._id, 10),
  ]);
  return {
    quickCards: [
      { id: "journeys", type: "journeys", title: "Journeys", subtitle: "Curated by @seen", route: "/search?type=journeys" },
      { id: "places", type: "places", title: "Places", subtitle: "From local tips", route: "/search?type=places" },
    ],
    trending,
    recent,
    categories: DEFAULT_CATEGORIES,
  };
}

export async function searchSuggestions({ q, user }) {
  const query = normalizeQuery(q);
  if (query.length < 1) return { suggestions: [] };
  const params = { blockedIds: await blockedIdsFor(user._id), limit: 3, query, user, sort: "relevant" };
  const [recent, people, worlds, places] = await Promise.all([
    getRecentSearches(user._id, 5),
    query.length >= 2 ? searchPeople(params) : resultPage([], 0, 3, 0),
    query.length >= 2 ? searchContent({ ...params, type: "world" }) : resultPage([], 0, 3, 0),
    searchPlaces(params),
  ]);
  const categorySuggestions = DEFAULT_CATEGORIES
    .filter((item) => normalizedKey(item).startsWith(normalizedKey(query)))
    .slice(0, 3)
    .map((label) => ({ id: `category-${label}`, type: "category", label, value: label, route: `/search?category=${encodeURIComponent(label)}` }));
  const recentSuggestions = recent
    .filter((item) => normalizedKey(item.query).includes(normalizedKey(query)))
    .slice(0, 2)
    .map((item) => ({ id: item.id, type: "recent", label: item.query, value: item.query, route: `/search?q=${encodeURIComponent(item.query)}&type=${item.selectedType}` }));
  const resultSuggestions = [
    ...people.items.map((item) => ({ id: item.id, type: "person", label: item.title, value: item.title, route: item.route })),
    ...worlds.items.map((item) => ({ id: item.id, type: "world", label: item.title, value: item.title, route: item.route })),
    ...places.items.map((item) => ({ id: item.id, type: "place", label: item.title, value: item.title, route: item.route })),
  ];
  return { suggestions: [...recentSuggestions, ...categorySuggestions, ...resultSuggestions].slice(0, 8) };
}

export async function runSearch(user, params) {
  if (params.q.length < 2 && !params.category && !params.location) {
    throw new ApiError(400, "Enter at least 2 characters to search");
  }
  const blockedIds = await blockedIdsFor(user._id);
  const shared = {
    blockedIds,
    category: params.category,
    cursor: params.cursor,
    limit: params.limit,
    location: params.location,
    query: params.q,
    sort: params.sort,
    user,
  };
  if (params.q) await recordRecentSearch({ q: params.q, type: params.type, userId: user._id });

  if (params.type === "all") {
    const sections = {};
    const allShared = { ...shared, cursor: 0 };
    const [people, worlds, seens, posts, places, journeys] = await Promise.all([
      searchPeople({ ...allShared, limit: ALL_PREVIEW_LIMITS.people }),
      searchContent({ ...allShared, limit: ALL_PREVIEW_LIMITS.worlds, type: "world" }),
      searchContent({ ...allShared, limit: ALL_PREVIEW_LIMITS.seens, type: "seen" }),
      searchPosts({ ...allShared, limit: ALL_PREVIEW_LIMITS.posts }),
      searchPlaces({ ...allShared, limit: ALL_PREVIEW_LIMITS.places }),
      searchJourneys({ ...allShared, limit: ALL_PREVIEW_LIMITS.journeys }),
    ]);
    Object.assign(sections, { people, worlds, seens, posts, places, journeys, saved: resultPage([], 0, 0, 0) });
    return { query: params.q, type: params.type, sections };
  }

  const runners = {
    people: () => searchPeople(shared),
    worlds: () => searchContent({ ...shared, type: "world" }),
    seens: () => searchContent({ ...shared, type: "seen" }),
    posts: () => searchPosts(shared),
    places: () => searchPlaces(shared),
    journeys: () => searchJourneys(shared),
    saved: () => searchSaved(shared),
  };
  const result = await runners[params.type]();
  return { query: params.q, type: params.type, ...result };
}
