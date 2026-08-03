import mongoose from "mongoose";
import CreatorProfile from "../models/CreatorProfile.js";
import FanProfile from "../models/FanProfile.js";
import FeedPost from "../models/FeedPost.js";
import ProfileRelationship from "../models/ProfileRelationship.js";
import Publication from "../models/Publication.js";
import Story from "../models/Story.js";
import Subscription from "../models/Subscription.js";
import UserBlock from "../models/UserBlock.js";
import WorldEntitlement from "../models/WorldEntitlement.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

const DISCOVER_TAGS = [
  "Photography", "Travel", "Fitness", "Food", "Music", "Gaming", "Fashion", "Art",
  "Business", "Technology", "Lifestyle", "Education", "Sports", "Pets", "Comedy",
];
const DISCOVER_REASONS = [
  "Popular near you",
  "Because you follow Fitness",
  "Friends follow this creator",
  "Trending today",
  "New creator",
  "Similar interests",
  "Recently active",
];
const DEFAULT_SETTINGS = {
  recommendations: true,
  peopleNearby: true,
  risingCreators: true,
  newCreators: true,
  languages: ["English"],
  preferredCity: "",
  topics: [],
  hiddenCreators: [],
};

function roleProfileModel(role) {
  return role === "creator" ? CreatorProfile : FanProfile;
}

function cleanText(value, maxLength = 120) {
  return String(value || "").replace(/\s+/gu, " ").trim().slice(0, maxLength);
}

function objectIdList(values = []) {
  return values.filter((value) => mongoose.isValidObjectId(value)).map((value) => new mongoose.Types.ObjectId(value));
}

function publicLocation(profile = {}) {
  if (profile.privacySettings?.showLocation === false) return "";
  return [profile.city, profile.country].filter(Boolean).join(", ");
}

function discoverSettings(profile = {}) {
  const settings = profile.discoverSettings || {};
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    preferredCity: settings.preferredCity || profile.city || "",
    languages: settings.languages?.length ? settings.languages : [profile.preferredLanguage || "English"],
    topics: settings.topics || [],
    hiddenCreators: (settings.hiddenCreators || []).map(String),
  };
}

async function blockedIdsFor(userId) {
  const blocks = await UserBlock.find({ $or: [{ blocker: userId }, { blocked: userId }] }).select("blocker blocked").lean();
  return new Set(blocks.map((block) => String(block.blocker) === String(userId) ? String(block.blocked) : String(block.blocker)));
}

async function countsBy(collection, match, groupField) {
  const rows = await collection.aggregate([
    { $match: match },
    { $group: { _id: `$${groupField}`, count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
}

function creatorTags(profile = {}) {
  return [...new Set([profile.category, ...(profile.categories || [])].filter(Boolean))].slice(0, 5);
}

function reasonFor(profile, index, viewerProfile) {
  const viewerInterests = new Set([...(viewerProfile?.interests || []), ...(viewerProfile?.categories || []), viewerProfile?.category].filter(Boolean).map((item) => item.toLowerCase()));
  const matchingTag = creatorTags(profile).find((tag) => viewerInterests.has(tag.toLowerCase()));
  if (matchingTag) return `Because you follow ${matchingTag}`;
  if (profile.city && viewerProfile?.city && profile.city.toLowerCase() === viewerProfile.city.toLowerCase()) return "Popular near you";
  return DISCOVER_REASONS[index % DISCOVER_REASONS.length];
}

function serializeCreator(profile, meta = {}) {
  const user = profile.user || {};
  const tags = creatorTags(profile);
  const followerCount = meta.followerCounts.get(String(user._id)) || 0;
  const subscriberCount = meta.subscriberCounts.get(String(user._id)) || 0;
  const worldMembers = meta.worldMemberCounts.get(String(user._id)) || 0;
  return {
    id: String(user._id),
    name: user.name || user.username || "Creator",
    username: user.username || "",
    avatar: user.avatar || "",
    cover: profile.coverPhoto || "",
    verified: Boolean(user.isVerified),
    category: profile.category || tags[0] || "Creator",
    location: publicLocation(profile),
    city: profile.city || "",
    country: profile.country || "",
    bio: cleanText(profile.bio || profile.orbitQuote || "Creating useful sightings from their world.", 220),
    tags,
    followers: followerCount,
    subscribers: subscriberCount,
    worldMembers,
    subscriptionPrice: `$${((profile.subscriptionPriceCents || 300) / 100).toFixed(0)}/mo`,
    previewThumbnails: meta.previewByCreator.get(String(user._id)) || [],
    whyRecommended: meta.reason || "",
    following: Boolean(meta.followingSet?.has(String(user._id))),
    createdAt: user.createdAt || profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function publicationCover(publication = {}) {
  return publication.coverMedia?.secureUrl || publication.introMedia?.secureUrl || "";
}

function serializeWorld(publication, meta = {}) {
  const owner = publication.creator || {};
  const metadata = publication.publishedSnapshot?.metadata || {};
  const price = publication.pricing?.starsAmount || metadata.pricing?.starsAmount || null;
  return {
    id: String(publication._id),
    title: publication.title || metadata.title || "Creator World",
    cover: publicationCover(publication),
    preview: cleanText(publication.summary || metadata.summary || publication.description, 180),
    category: publication.category || metadata.category || "World",
    kind: publication.kind,
    route: `/world/${publication._id}`,
    priceStars: price,
    subscribers: meta.worldMemberCounts.get(String(publication._id)) || 0,
    owner: {
      id: String(owner._id || ""),
      name: owner.name || "Creator",
      username: owner.username || "",
      avatar: owner.avatar || "",
      verified: Boolean(owner.isVerified),
    },
  };
}

function serializeStory(story) {
  const owner = story.creator || {};
  const mediaUrl = story.image?.url || "";
  return {
    id: String(story._id),
    owner: {
      id: String(owner._id || ""),
      name: owner.name || "Creator",
      username: owner.username || "",
      avatar: owner.avatar || "",
      verified: Boolean(owner.isVerified),
      role: owner.role || "creator",
    },
    mediaType: story.mediaType || "image",
    mediaUrl,
    image: mediaUrl,
    thumbnailUrl: mediaUrl,
    caption: story.caption || "",
    duration: story.duration || 5,
    editorMetadata: story.editorMetadata,
    audience: story.audience,
    allowReactions: story.allowReactions !== false,
    allowReplies: story.allowReplies !== false,
    allowSharing: story.allowSharing !== false,
    createdAt: story.createdAt,
    expiresAt: story.expiresAt,
    viewed: false,
  };
}

function categoryImage(category) {
  const key = category.toLowerCase();
  const palette = {
    travel: "linear-gradient(135deg,#12365c,#8ab8ff)",
    fitness: "linear-gradient(135deg,#12291f,#6ecf97)",
    food: "linear-gradient(135deg,#372414,#f0b764)",
    music: "linear-gradient(135deg,#28143a,#b58cff)",
    gaming: "linear-gradient(135deg,#0e2635,#63d8ff)",
    fashion: "linear-gradient(135deg,#351725,#f178b6)",
    technology: "linear-gradient(135deg,#111d35,#5e9bff)",
  };
  return palette[key] || "linear-gradient(135deg,#111827,#8ab8ff)";
}

function categoriesFromCreators(creators) {
  const counts = new Map();
  for (const creator of creators) {
    for (const tag of creator.tags?.length ? creator.tags : [creator.category]) {
      const label = cleanText(tag, 40);
      if (label) counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  const merged = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([title, count]) => ({ id: title.toLowerCase(), title, creatorCount: count, image: categoryImage(title), tag: title }));
  const missing = DISCOVER_TAGS.filter((tag) => !counts.has(tag)).slice(0, 8).map((title) => ({ id: title.toLowerCase(), title, creatorCount: 0, image: categoryImage(title), tag: title }));
  return [...merged, ...missing].slice(0, 16);
}

function groupStories(stories) {
  const groups = new Map();
  for (const story of stories.map(serializeStory)) {
    const ownerId = story.owner.id || story.owner.username || story.id;
    if (!groups.has(ownerId)) {
      groups.set(ownerId, {
        id: ownerId,
        owner: story.owner,
        stories: [],
        live: new Date(story.createdAt).getTime() > Date.now() - 15 * 60 * 1000,
        seen: false,
      });
    }
    groups.get(ownerId).stories.push(story);
  }
  return Array.from(groups.values());
}

function filterCreators(creators, term) {
  if (!term) return creators;
  const query = term.toLowerCase();
  return creators.filter((creator) => [
    creator.name,
    creator.username,
    creator.category,
    creator.location,
    creator.bio,
    ...(creator.tags || []),
  ].some((value) => String(value || "").toLowerCase().includes(query)));
}

export const getDiscover = asyncHandler(async (req, res) => {
  const viewerModel = roleProfileModel(req.user.role);
  const viewerProfile = ["fan", "creator"].includes(req.user.role) ? await viewerModel.findOne({ user: req.user._id }).lean() : null;
  const settings = discoverSettings(viewerProfile);
  const blockedIds = await blockedIdsFor(req.user._id);
  settings.hiddenCreators.forEach((id) => blockedIds.add(String(id)));
  const excludedIds = objectIdList([req.user._id, ...blockedIds]);
  const search = cleanText(req.query.search, 80);

  const profiles = await CreatorProfile.find({
    user: { $nin: excludedIds },
    profileVisibility: "public",
    "privacySettings.allowDiscovery": { $ne: false },
  })
    .populate({ path: "user", match: { role: "creator", status: "active", creatorApprovalStatus: "approved" }, select: "name username avatar isVerified role creatorApprovalStatus status createdAt" })
    .sort({ updatedAt: -1 })
    .limit(80)
    .lean();

  const visibleProfiles = profiles.filter((profile) => profile.user);
  const creatorIds = visibleProfiles.map((profile) => profile.user._id);
  const [followerCounts, subscriberCounts, worldCounts, following, publications, posts, stories] = await Promise.all([
    countsBy(ProfileRelationship, { target: { $in: creatorIds }, type: "FOLLOW" }, "target"),
    countsBy(Subscription, { creator: { $in: creatorIds }, status: { $in: ["active", "ACTIVE", "cancel_at_period_end", "CANCEL_AT_PERIOD_END"] } }, "creator"),
    countsBy(WorldEntitlement, { creator: { $in: creatorIds }, status: "ACTIVE" }, "creator"),
    ProfileRelationship.find({ actor: req.user._id, target: { $in: creatorIds }, type: "FOLLOW" }).select("target").lean(),
    Publication.find({ creator: { $in: creatorIds }, kind: { $in: ["WORLD", "PREMIUM_WORLD"] }, status: "PUBLISHED", publishedSnapshot: { $exists: true } })
      .sort({ publishedAt: -1, updatedAt: -1 })
      .limit(36)
      .populate("creator", "name username avatar isVerified")
      .lean(),
    FeedPost.find({ author: { $in: creatorIds }, status: "published", visibility: "public", deletedAt: null })
      .sort({ publishedAt: -1, createdAt: -1 })
      .limit(80)
      .select("author media")
      .lean(),
    Story.find({ creator: { $in: creatorIds }, expiresAt: { $gt: new Date() }, audience: { $in: ["everyone", "followers"] } })
      .sort({ createdAt: -1 })
      .limit(40)
      .populate("creator", "name username avatar isVerified role")
      .lean(),
  ]);

  const followingSet = new Set(following.map((item) => String(item.target)));
  const previewByCreator = new Map();
  for (const post of posts) {
    const url = (post.media || [])[0]?.url;
    if (!url) continue;
    const key = String(post.author);
    previewByCreator.set(key, [...(previewByCreator.get(key) || []), url].slice(0, 3));
  }

  const meta = { followerCounts, subscriberCounts, worldMemberCounts: worldCounts, followingSet, previewByCreator };
  const creators = visibleProfiles.map((profile, index) => serializeCreator(profile, { ...meta, reason: reasonFor(profile, index, viewerProfile) }));
  const searchedCreators = filterCreators(creators, search);
  const byFollowers = [...searchedCreators].sort((left, right) => right.followers - left.followers || new Date(right.updatedAt) - new Date(left.updatedAt));
  const byNewest = [...searchedCreators].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  const viewerCity = settings.preferredCity || viewerProfile?.city || "";
  const nearbyCreators = searchedCreators.filter((creator) => viewerCity && creator.city?.toLowerCase() === viewerCity.toLowerCase());
  const worldsByPublication = await countsBy(WorldEntitlement, { publication: { $in: publications.map((item) => item._id) }, status: "ACTIVE" }, "publication");
  const worlds = publications.map((publication) => serializeWorld(publication, { worldMemberCounts: worldsByPublication }));
  const categories = categoriesFromCreators(creators);
  const trendingTags = [...new Set([...creators.flatMap((creator) => creator.tags || []), ...DISCOVER_TAGS])].slice(0, 18);
  const interestTags = [...new Set([...(viewerProfile?.interests || []), ...(viewerProfile?.categories || []), viewerProfile?.category, ...DISCOVER_TAGS].filter(Boolean))].slice(0, 18);

  return sendResponse(res, 200, "Discover fetched", {
    featuredCreators: byFollowers.slice(0, 1),
    recommendedCreators: searchedCreators.slice(0, 16),
    nearbyCreators: nearbyCreators.slice(0, 16),
    risingCreators: byFollowers.slice(0, 16),
    newCreators: byNewest.slice(0, 16),
    categories,
    interestTags,
    trendingTags,
    discoverReasons: DISCOVER_REASONS,
    viewerLocation: [viewerCity, viewerProfile?.country].filter(Boolean).join(", "),
    recentlyViewed: [],
    friendsOfFriends: searchedCreators.filter((creator) => !creator.following).slice(3, 15),
    popularWorlds: worlds.slice(0, 16),
    recommendedWorlds: worlds.filter((world) => interestTags.includes(world.category)).slice(0, 16),
    creatorStories: groupStories(stories),
    featuredExperiences: worlds.slice(0, 8).map((world) => ({
      id: world.id,
      title: world.title,
      cover: world.cover,
      category: world.category,
      route: world.route,
      creator: world.owner,
      reason: world.kind === "PREMIUM_WORLD" ? "Premium world preview" : "Popular world",
    })),
    settings,
  });
});

function readBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function readStringArray(value, max = 20) {
  return Array.isArray(value) ? value.map((item) => cleanText(item, 40)).filter(Boolean).slice(0, max) : [];
}

function readTopics(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 40).map((item) => ({
    label: cleanText(item.label || item, 40),
    preference: ["interested", "less", "neutral"].includes(item.preference) ? item.preference : "neutral",
  })).filter((item) => item.label);
}

export const updateDiscoverSettings = asyncHandler(async (req, res) => {
  const Model = roleProfileModel(req.user.role);
  const currentProfile = await Model.findOne({ user: req.user._id });
  const current = discoverSettings(currentProfile || {});
  const payload = req.body || {};
  const next = {
    recommendations: readBoolean(payload.recommendations, current.recommendations),
    peopleNearby: readBoolean(payload.peopleNearby, current.peopleNearby),
    risingCreators: readBoolean(payload.risingCreators, current.risingCreators),
    newCreators: readBoolean(payload.newCreators, current.newCreators),
    languages: readStringArray(payload.languages).length ? readStringArray(payload.languages) : current.languages,
    preferredCity: payload.preferredCity === undefined ? current.preferredCity : cleanText(payload.preferredCity, 80),
    topics: payload.topics === undefined ? current.topics : readTopics(payload.topics),
    hiddenCreators: payload.hiddenCreators === undefined ? current.hiddenCreators : objectIdList(readStringArray(payload.hiddenCreators, 100)),
    updatedAt: new Date(),
  };

  const updated = await Model.findOneAndUpdate(
    { user: req.user._id },
    { $set: { discoverSettings: next } },
    { new: true, upsert: false, setDefaultsOnInsert: true },
  ).lean();

  return sendResponse(res, 200, "Discover settings updated", { settings: discoverSettings(updated) });
});

export const resetDiscoverSettings = asyncHandler(async (req, res) => {
  const Model = roleProfileModel(req.user.role);
  const updated = await Model.findOneAndUpdate(
    { user: req.user._id },
    { $set: { discoverSettings: { ...DEFAULT_SETTINGS, updatedAt: new Date() } } },
    { new: true },
  ).lean();
  return sendResponse(res, 200, "Discover settings reset", { settings: discoverSettings(updated) });
});
