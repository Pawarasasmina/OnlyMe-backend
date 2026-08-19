import mongoose from "mongoose";
import CreatorProfile from "../models/CreatorProfile.js";
import FanProfile from "../models/FanProfile.js";
import FeedPost from "../models/FeedPost.js";
import MessageReport from "../models/MessageReport.js";
import OrbitDream from "../models/OrbitDream.js";
import OrbitSignal from "../models/OrbitSignal.js";
import PremiumMembership from "../models/PremiumMembership.js";
import ProfileRelationship from "../models/ProfileRelationship.js";
import Publication from "../models/Publication.js";
import SeenEngagement from "../models/SeenEngagement.js";
import Story from "../models/Story.js";
import StoryEngagement from "../models/StoryEngagement.js";
import Subscription from "../models/Subscription.js";
import UserBlock from "../models/UserBlock.js";
import WorldEntitlement from "../models/WorldEntitlement.js";
import {
  mutualFollowIds,
  serializeDiscoverFriend,
  serializeDiscoverStory,
  sortDiscoverFriends,
} from "../services/discoverFriendsService.js";
import ApiError from "../utils/ApiError.js";
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
const DISCOVER_FILTERS = [
  { id: "for_you", label: "For You" },
  { id: "nearby", label: "Nearby" },
  { id: "rising", label: "Rising" },
  { id: "new", label: "New" },
  { id: "creators", label: "Creators" },
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
const MAX_LIMIT = 18;
const DEFAULT_LIMIT = 8;
const SESSION_WINDOW = 1000 * 60 * 30;
const REPORT_REASONS = new Set(["SPAM", "HARASSMENT", "HATE", "SEXUAL_CONTENT", "VIOLENCE", "SCAM", "OTHER"]);

function roleProfileModel(role, creatorApprovalStatus = null) {
  return role === "creator" || creatorApprovalStatus === "approved" ? CreatorProfile : FanProfile;
}

function cleanText(value, maxLength = 120) {
  return String(value || "").replace(/\s+/gu, " ").trim().slice(0, maxLength);
}

function objectIdList(values = []) {
  return values.filter((value) => mongoose.isValidObjectId(value)).map((value) => new mongoose.Types.ObjectId(value));
}

function requireObjectId(value, label = "id") {
  if (!mongoose.isValidObjectId(value)) throw new ApiError(400, `Invalid ${label}`);
}

function publicLocation(profile = {}) {
  if (profile.privacySettings?.showLocation === false) return "";
  return [profile.city, profile.country].filter(Boolean).join(", ");
}

function discoverSettings(profile = {}) {
  const safeProfile = profile || {};
  const settings = safeProfile.discoverSettings || {};
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    preferredCity: settings.preferredCity || safeProfile.city || "",
    languages: settings.languages?.length ? settings.languages : [safeProfile.preferredLanguage || "English"],
    topics: Array.isArray(settings.topics) ? settings.topics : [],
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

function reasonDetailsFor(profile, index, viewerProfile, matchingWorld = null) {
  const viewerInterests = new Set([...(viewerProfile?.interests || []), ...(viewerProfile?.categories || []), viewerProfile?.category].filter(Boolean).map((item) => item.toLowerCase()));
  const matchingTag = creatorTags(profile).find((tag) => viewerInterests.has(tag.toLowerCase()));
  if (matchingTag) return { code: "SHARED_INTERESTS", label: "WHY YOU TWO", detail: `You both follow ${matchingTag}` };
  if (matchingWorld?.category) return { code: "WORLD_MATCH", label: "TRENDING IN YOUR WORLD", detail: `Their World matches ${matchingWorld.category}` };
  if (profile.city && viewerProfile?.city && profile.city.toLowerCase() === viewerProfile.city.toLowerCase()) {
    return { code: "SAME_CITY", label: "NEAR YOU", detail: `Recently active in ${profile.city}` };
  }
  const fallback = [
    { code: "POPULAR_NEARBY", label: "NEAR YOU", detail: "Popular near you" },
    { code: "FOLLOW_GRAPH", label: "BECAUSE YOU FOLLOW", detail: "People you follow also see them" },
    { code: "RISING_CREATOR", label: "NEW LIGHT", detail: "A rising creator in your orbit" },
    { code: "RECENT_ACTIVITY", label: "SHARED INSTINCT", detail: "Recently active with public work" },
  ];
  return fallback[index % fallback.length];
}

function serializeCreator(profile, meta = {}) {
  const user = profile.user || {};
  const tags = creatorTags(profile);
  const followerCount = meta.followerCounts.get(String(user._id)) || 0;
  const subscriberCount = meta.subscriberCounts.get(String(user._id)) || 0;
  const worldMembers = meta.worldMemberCounts.get(String(user._id)) || 0;
  const location = publicLocation(profile);
  return {
    id: String(user._id),
    name: user.name || user.username || "Creator",
    displayName: user.name || user.username || "Creator",
    username: user.username || "",
    avatar: user.avatar || "",
    cover: profile.coverPhoto || "",
    coverImage: profile.coverPhoto || meta.previewByCreator.get(String(user._id))?.[0] || "",
    verified: Boolean(user.isVerified),
    isVerified: Boolean(user.isVerified),
    category: profile.category || tags[0] || "Creator",
    location,
    city: profile.city || "",
    country: profile.country || "",
    bio: cleanText(profile.bio || profile.orbitQuote || "Creating useful sightings from their world.", 220),
    tags,
    followers: followerCount,
    followersCount: followerCount,
    subscribers: subscriberCount,
    worldMembers,
    subscriptionPrice: `$${((profile.subscriptionPriceCents || 300) / 100).toFixed(0)}/mo`,
    previewThumbnails: meta.previewByCreator.get(String(user._id)) || [],
    whyRecommended: meta.reason || "",
    recommendationReason: meta.reason || "",
    following: Boolean(meta.followingSet?.has(String(user._id))),
    isFollowing: Boolean(meta.followingSet?.has(String(user._id))),
    storyAvailable: Boolean(meta.storyCreatorIds?.has(String(user._id))),
    profileUrl: `/profile/${encodeURIComponent(user.username || String(user._id))}`,
    createdAt: user.createdAt || profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function publicationCover(publication = {}) {
  const safePublication = publication || {};
  return safePublication.coverMedia?.secureUrl || safePublication.introMedia?.secureUrl || "";
}

function firstChapterMedia(publication = {}) {
  const safePublication = publication || {};
  const chapters = safePublication.publishedSnapshot?.chapters || [];
  for (const chapter of chapters) {
    if (!chapter.isPreview && safePublication.kind !== "SEEN") continue;
    const mediaBlock = (chapter.blocks || []).find((block) => block.media?.secureUrl);
    if (mediaBlock) return mediaBlock.media;
  }
  return null;
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

function serializeOffer(publication, meta = {}) {
  if (!publication) return null;
  const metadata = publication.publishedSnapshot?.metadata || {};
  const pricing = publication.pricing || metadata.pricing || {};
  const price = Number(pricing.starsAmount || 0);
  const isFree = pricing.mode === "FREE" || price <= 0;
  const viewerHasAccess = Boolean(
    meta.viewerId && String(meta.viewerId) === String(publication.creator?._id || publication.creator)
    || meta.entitledPublicationIds?.has(String(publication._id))
  );
  return {
    type: "world",
    id: String(publication._id),
    label: publication.kind === "PREMIUM_WORLD" ? "PREMIUM WORLD" : "FEATURED WORLD",
    title: cleanText(publication.title || metadata.title || "Creator World", 120),
    price: isFree ? 0 : price,
    currency: "Stars",
    isFree,
    viewerHasAccess,
    saved: Boolean(meta.savedPublicationIds?.has(String(publication._id))),
    peopleCount: meta.peopleCount || 0,
    route: `/world/${publication._id}`,
    cta: viewerHasAccess ? "Continue" : isFree ? "Step inside" : "Unlock",
  };
}

function mediaForSlide(profile, creatorId, world, previewByCreator) {
  const cover = profile.coverPhoto || "";
  const preview = previewByCreator.get(String(creatorId))?.[0] || "";
  const worldCover = publicationCover(world);
  const chapterMedia = firstChapterMedia(world);
  const url = cover || preview || worldCover || chapterMedia?.secureUrl || "";
  if (!url) {
    const label = creatorTags(profile)[0] || profile.category || "Creator";
    return {
      type: "fallback",
      url: "",
      poster: null,
      alt: `${label} creator background`,
    };
  }
  const mediaType = chapterMedia?.secureUrl === url && chapterMedia?.resourceType === "video" ? "video" : "image";
  return {
    type: mediaType,
    url,
    poster: mediaType === "video" ? worldCover || cover || preview || null : null,
    alt: `${profile.user?.name || "Creator"} public media`,
  };
}

function serializeDream(dream) {
  if (!dream) return null;
  return {
    id: String(dream._id || dream.id),
    title: cleanText(dream.title, 120),
    emoji: cleanText(dream.emoji, 8),
    status: dream.status,
  };
}

function slideScore(profile, meta = {}) {
  const tags = creatorTags(profile).map((tag) => tag.toLowerCase());
  const topicEntries = Array.isArray(meta.settings?.topics) ? meta.settings.topics : [];
  const interested = new Set(topicEntries.filter((topic) => topic?.preference === "interested" && topic.label).map((topic) => topic.label.toLowerCase()));
  const less = new Set(topicEntries.filter((topic) => topic?.preference === "less" && topic.label).map((topic) => topic.label.toLowerCase()));
  let score = 0;
  score += tags.filter((tag) => interested.has(tag)).length * 28;
  score -= tags.filter((tag) => less.has(tag)).length * 18;
  if (profile.city && meta.viewerCity && profile.city.toLowerCase() === meta.viewerCity.toLowerCase()) score += 20;
  if (profile.country && meta.viewerCountry && profile.country.toLowerCase() === meta.viewerCountry.toLowerCase()) score += 8;
  score += Math.min(30, meta.followerCounts.get(String(profile.user._id)) || 0) / 3;
  score += Math.min(18, (meta.previewByCreator.get(String(profile.user._id)) || []).length * 6);
  if (profile.user?.isVerified) score += 4;
  score += new Date(profile.updatedAt || profile.createdAt || 0).getTime() / 100000000000000;
  return score;
}

function filterSlides(items, filter, settings) {
  if (filter === "for_you" || filter === "creators") return items;
  if (filter === "nearby") return settings.peopleNearby === false ? [] : items.filter((item) => item.match.nearby);
  if (filter === "following") return items.filter((item) => item.match.following);
  if (filter === "new") return settings.newCreators === false ? [] : [...items].sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));
  if (filter === "rising" || filter === "trending") return settings.risingCreators === false ? [] : [...items].sort((left, right) => right.rankSignals.followers - left.rankSignals.followers || right.rankSignals.worldMembers - left.rankSignals.worldMembers);
  const label = DISCOVER_FILTERS.find((item) => item.id === filter)?.label || "";
  if (!label) return items;
  return items.filter((item) => item.match.tags.some((tag) => tag.toLowerCase() === label.toLowerCase()));
}

function parseLimit(value) {
  const limit = Number(value) || DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

function parseCursor(value) {
  return Math.max(0, Number(value) || 0);
}

function sessionIdFor(userId, filter, date = new Date()) {
  return `discover:${String(userId)}:${filter}:${Math.floor(date.getTime() / SESSION_WINDOW)}`;
}

async function activeSignalTargetIds(userId) {
  const signals = await OrbitSignal.find({ sender: userId, type: "SEE_YOU", status: "active" }).select("targetUser").lean();
  return new Set(signals.map((signal) => String(signal.targetUser)));
}

async function publicDreamByCreator(creatorIds) {
  const dreams = await OrbitDream.find({
    user: { $in: creatorIds },
    visibility: "public",
    status: { $in: ["active", "completed"] },
  }).sort({ status: 1, updatedAt: -1 }).lean();
  const result = new Map();
  for (const dream of dreams) {
    const key = String(dream.user);
    if (!result.has(key)) result.set(key, dream);
  }
  return result;
}

async function entitlementIdsFor(viewer, publications) {
  if (!viewer?._id || !publications.length) return new Set();
  const ids = publications.map((item) => item._id);
  const [worlds, memberships] = await Promise.all([
    WorldEntitlement.find({ user: viewer._id, publication: { $in: ids }, status: "ACTIVE" }).select("publication").lean(),
    PremiumMembership.find({
      user: viewer._id,
      premiumPublication: { $in: ids },
      status: { $in: ["ACTIVE", "CANCEL_AT_PERIOD_END"] },
      currentPeriodEnd: { $gt: new Date() },
    }).select("premiumPublication").lean(),
  ]);
  return new Set([
    ...worlds.map((item) => String(item.publication)),
    ...memberships.map((item) => String(item.premiumPublication)),
  ]);
}

function buildSlide(profile, index, meta) {
  const user = profile.user;
  const creatorId = String(user._id);
  const featuredWorld = meta.publicationByCreator.get(creatorId) || null;
  const reason = reasonDetailsFor(profile, index, meta.viewerProfile, featuredWorld);
  const tags = creatorTags(profile);
  const media = mediaForSlide(profile, creatorId, featuredWorld, meta.previewByCreator);
  const location = {
    city: profile.privacySettings?.showLocation === false ? "" : cleanText(profile.city, 80),
    country: profile.privacySettings?.showLocation === false ? "" : cleanText(profile.country, 80),
  };
  const followers = meta.followerCounts.get(creatorId) || 0;
  const worldMembers = meta.worldMemberCounts.get(creatorId) || 0;
  const offerMemberCount = featuredWorld ? meta.publicationMemberCounts.get(String(featuredWorld._id)) || 0 : 0;
  const profileRoute = `/profile/${encodeURIComponent(user.username || creatorId)}`;
  return {
    id: `discover:${creatorId}`,
    coverImage: media.url || profile.coverPhoto || "",
    avatar: user.avatar || "",
    displayName: user.name || user.username || "Creator",
    username: user.username || "",
    category: profile.category || tags[0] || "Creator",
    city: location.city,
    country: location.country,
    recommendationReason: reason.detail,
    isVerified: Boolean(user.isVerified),
    isFollowing: Boolean(meta.followingSet?.has(creatorId)),
    followersCount: followers,
    storyAvailable: Boolean(meta.storyCreatorIds?.has(creatorId)),
    profileUrl: profileRoute,
    creator: {
      id: creatorId,
      name: user.name || user.username || "Creator",
      username: user.username || "",
      avatar: user.avatar || "",
      cover: profile.coverPhoto || "",
      verified: Boolean(user.isVerified),
      status: cleanText(profile.orbitStatus || profile.category || tags[0] || "At seen", 80),
      location,
      category: profile.category || tags[0] || "Creator",
      profileRoute,
    },
    media,
    reason,
    quote: cleanText(profile.orbitQuote, 180),
    dream: serializeDream(meta.dreamByCreator.get(creatorId)),
    featuredOffer: serializeOffer(featuredWorld, {
      viewerId: meta.viewerId,
      entitledPublicationIds: meta.entitledPublicationIds,
      savedPublicationIds: meta.savedPublicationIds,
      peopleCount: offerMemberCount,
    }),
    actions: {
      hasSeenSignal: meta.signalTargetIds.has(creatorId),
      saved: Boolean(featuredWorld && meta.savedPublicationIds.has(String(featuredWorld._id))),
      saveTarget: featuredWorld ? { type: "publication", id: String(featuredWorld._id) } : null,
      messageAllowed: meta.viewerRole === "fan" && profile.messagingEnabled !== false,
      directAccessRequired: meta.viewerRole === "fan" && profile.messagingEnabled === false && profile.directAccessEnabled !== false,
      directAccessAvailable: meta.viewerRole === "fan" && profile.directAccessEnabled !== false,
      blocked: false,
      following: Boolean(meta.followingSet?.has(creatorId)),
      reportable: true,
      hideable: true,
      blockable: true,
    },
    match: {
      nearby: Boolean(meta.viewerCity && profile.city && profile.city.toLowerCase() === meta.viewerCity.toLowerCase()),
      following: Boolean(meta.followingSet?.has(creatorId)),
      tags,
    },
    rankSignals: { followers, worldMembers, updatedAt: profile.updatedAt },
    createdAt: user.createdAt || profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function publicSlide(slide) {
  const safeSlide = { ...slide };
  delete safeSlide.match;
  delete safeSlide.rankSignals;
  delete safeSlide.createdAt;
  delete safeSlide.updatedAt;
  return safeSlide;
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

async function profilesByUser(users = [], { publicOnly = true } = {}) {
  const creatorIds = users.filter((user) => user.creatorApprovalStatus === "approved").map((user) => user._id);
  const fanIds = users.filter((user) => user.creatorApprovalStatus !== "approved").map((user) => user._id);
  const creatorMatch = publicOnly
    ? {
      user: { $in: creatorIds },
      profileVisibility: "public",
      "privacySettings.allowDiscovery": { $ne: false },
    }
    : { user: { $in: creatorIds } };
  const fanMatch = publicOnly
    ? {
      user: { $in: fanIds },
      profileVisibility: "public",
      "privacySettings.allowDiscovery": { $ne: false },
    }
    : { user: { $in: fanIds } };
  const [creatorProfiles, fanProfiles] = await Promise.all([
    creatorIds.length ? CreatorProfile.find(creatorMatch).lean() : [],
    fanIds.length ? FanProfile.find(fanMatch).lean() : [],
  ]);
  return new Map([...creatorProfiles, ...fanProfiles].map((profile) => [String(profile.user), profile]));
}

function serializeDiscoverPerson(user, profile, meta = {}) {
  const id = String(user._id);
  const creatorEnabled = user.creatorApprovalStatus === "approved";
  const tags = creatorEnabled ? creatorTags(profile) : (profile.interests || []);
  const location = profile.privacySettings?.showLocation === false
    ? { city: "", country: "" }
    : { city: cleanText(profile.city, 80), country: cleanText(profile.country, 80) };
  const displayName = user.name || user.username || "Profile";
  const category = creatorEnabled ? profile.category || tags[0] || "Creator" : tags[0] || "Member";
  const isFollowing = meta.following ?? true;
  const stories = (meta.stories || []).sort((left, right) => new Date(left.createdAt || 0) - new Date(right.createdAt || 0));
  const firstUnseenStory = stories.find((story) => !story.viewed);
  const activeStoryCount = stories.length;
  const hasUnseenStory = Boolean(firstUnseenStory);
  const hasActiveStory = activeStoryCount > 0;
  return {
    id,
    displayName,
    name: displayName,
    username: user.username || "",
    avatar: user.avatar || "",
    coverImage: profile.coverPhoto || meta.previewByCreator?.get(id)?.[0] || "",
    category,
    city: location.city,
    country: location.country,
    location: [location.city, location.country].filter(Boolean).join(", "),
    recommendationReason: meta.reason || (meta.mutual ? "Follows you back" : "You follow them"),
    isVerified: Boolean(user.isVerified),
    verified: Boolean(user.isVerified),
    isFollowing,
    following: isFollowing,
    followersCount: meta.followerCounts?.get(id) || 0,
    followers: meta.followerCounts?.get(id) || 0,
    hasActiveStory,
    hasUnseenStory,
    activeStoryCount,
    firstUnseenStoryId: firstUnseenStory?.id || null,
    storyAvailable: hasActiveStory || Boolean(meta.storyAvailable),
    storyViewed: hasActiveStory && !hasUnseenStory,
    stories,
    online: Boolean(meta.online),
    profileUrl: `/profile/${encodeURIComponent(user.username || id)}`,
    role: user.role,
    updatedAt: profile.updatedAt,
    lastSeenAt: user.lastSeenAt || null,
  };
}

async function discoverConnections({ blockedIds, previewByCreator, viewerId }) {
  const blockedObjectIds = objectIdList([...blockedIds]);
  const [relationships, followerRows] = await Promise.all([
    ProfileRelationship.find({
    actor: viewerId,
    type: "FOLLOW",
    target: { $nin: blockedObjectIds },
  })
    .sort({ createdAt: -1, _id: -1 })
    .limit(80)
    .populate({
      path: "target",
      match: {
        _id: { $nin: [viewerId, ...blockedObjectIds] },
        role: { $in: ["fan", "creator"] },
        status: "active",
      },
      select: "name username avatar role isVerified creatorApprovalStatus lastSeenAt createdAt",
    })
      .lean(),
    ProfileRelationship.find({
      target: viewerId,
      type: "FOLLOW",
      actor: { $nin: blockedObjectIds },
    }).select("actor").lean(),
  ]);

  const users = relationships
    .map((relationship) => relationship.target)
    .filter((user) => user && (user.role !== "creator" || user.creatorApprovalStatus === "approved"));
  const uniqueUsers = Array.from(new Map(users.map((user) => [String(user?._id || ""), user])).values()).filter((user) => user?._id);
  const profilesById = await profilesByUser(uniqueUsers, { publicOnly: false });
  const visibleUsers = uniqueUsers;
  const ids = visibleUsers.map((user) => user._id);
  const mutualIds = mutualFollowIds(relationships, followerRows, viewerId, blockedIds);
  const mutualObjectIds = objectIdList([...mutualIds]);
  const [storyRows, premiumRows, followerCounts] = await Promise.all([
    ids.length ? Story.find({
      expiresAt: { $gt: new Date() },
      "image.url": { $ne: "" },
      $or: [
        { creator: { $in: ids }, audience: { $in: ["everyone", "followers"] } },
        { creator: { $in: mutualObjectIds }, audience: "close_circle" },
      ],
    }).sort({ createdAt: 1, _id: 1 }).populate("creator", "name username avatar isVerified role").lean() : [],
    ids.length ? Publication.find({ creator: { $in: ids }, kind: "PREMIUM_WORLD", status: "PUBLISHED", publishedSnapshot: { $exists: true } }).select("creator").lean() : [],
    ids.length ? countsBy(ProfileRelationship, { target: { $in: ids }, type: "FOLLOW" }, "target") : new Map(),
  ]);
  const fetchedStoryIds = storyRows.map((story) => story._id);
  const engagementRows = fetchedStoryIds.length
    ? await StoryEngagement.find({ fan: viewerId, story: { $in: fetchedStoryIds } }).lean()
    : [];
  const storyEngagementById = new Map(engagementRows.map((item) => [String(item.story), item]));
  const storiesByCreator = new Map();
  for (const story of storyRows) {
    const creatorId = String(story.creator?._id || story.creator);
    const serialized = serializeDiscoverStory(story, viewerId, storyEngagementById.get(String(story._id)));
    storiesByCreator.set(creatorId, [...(storiesByCreator.get(creatorId) || []), serialized]);
  }
  const premiumCreatorIds = new Set(premiumRows.map((item) => String(item.creator)));
  const storyIds = new Set(storiesByCreator.keys());
  const recentThreshold = Date.now() - 5 * 60 * 1000;
  const people = visibleUsers.map((user) => {
    const id = String(user._id);
    const profile = profilesById.get(id) || {};
    const shared = {
    followerCounts,
      mutual: mutualIds.has(id),
    online: user.lastSeenAt && new Date(user.lastSeenAt).getTime() > recentThreshold,
    previewByCreator,
      storyAvailable: storyIds.has(id),
    };
    return mutualIds.has(id)
      ? serializeDiscoverFriend(user, profile, {
        ...shared,
        hasPremiumOffering: user.role === "creator" && premiumCreatorIds.has(id),
        stories: storiesByCreator.get(id) || [],
      })
      : serializeDiscoverPerson(user, profile, {
        ...shared,
        stories: storiesByCreator.get(id) || [],
      });
  });
  const uniquePeople = Array.from(new Map(people.map((person) => [String(person.id || person.username || ""), person])).values())
    .filter((person) => (person?.id || person?.username) && String(person.id || "") !== String(viewerId || ""));
  return {
    friends: sortDiscoverFriends(uniquePeople.filter((person) => person.isMutualFollow)).slice(0, 12),
    following: uniquePeople.slice(0, 12),
  };
}

function serializeDiscoverSeen(publication, engagementCounts = new Map()) {
  const owner = publication.creator || {};
  const metadata = publication.publishedSnapshot?.metadata || {};
  const chapters = publication.publishedSnapshot?.chapters || [];
  return {
    id: String(publication._id),
    title: cleanText(publication.title || metadata.title || "Untitled Seen", 120),
    cover: publicationCover(publication),
    coverImage: publicationCover(publication),
    category: publication.category || metadata.category || "Seen",
    route: `/seen/${publication._id}`,
    engagementCount: engagementCounts.get(String(publication._id)) || 0,
    viewCount: engagementCounts.get(String(publication._id)) || 0,
    chapterCount: chapters.length,
    publishedAt: publication.publishedAt || publication.createdAt,
    creator: {
      id: String(owner._id || ""),
      name: owner.name || "Creator",
      username: owner.username || "",
      avatar: owner.avatar || "",
      verified: Boolean(owner.isVerified),
    },
  };
}

function serializeDiscoverActivity(profiles = []) {
  const recentThreshold = Date.now() - 24 * 60 * 60 * 1000;
  const active = profiles
    .filter((profile) => profile.privacySettings?.showActivityStatus !== false && profile.user?.lastSeenAt && new Date(profile.user.lastSeenAt).getTime() > recentThreshold)
    .sort((left, right) => new Date(right.user.lastSeenAt) - new Date(left.user.lastSeenAt));
  const primary = active[0];
  if (!primary?.user) return null;
  const name = primary.user.name || primary.user.username || "Creator";
  const firstName = name.split(" ")[0] || name;
  const otherCount = Math.max(0, active.length - 1);
  return {
    id: String(primary.user._id),
    actor: {
      id: String(primary.user._id),
      name,
      username: primary.user.username || "",
      avatar: primary.user.avatar || "",
      verified: Boolean(primary.user.isVerified),
      profileUrl: `/profile/${encodeURIComponent(primary.user.username || primary.user._id)}`,
    },
    count: active.length,
    online: true,
    text: otherCount ? `${firstName} and ${otherCount} others are At seen` : `${firstName} is At seen`,
    lastSeenAt: primary.user.lastSeenAt,
  };
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
  const viewerModel = roleProfileModel(req.user.role, req.user.creatorApprovalStatus);
  const viewerProfile = ["fan", "creator"].includes(req.user.role) ? await viewerModel.findOne({ user: req.user._id }).lean() : null;
  const settings = discoverSettings(viewerProfile);
  const blockedIds = await blockedIdsFor(req.user._id);
  settings.hiddenCreators.forEach((id) => blockedIds.add(String(id)));
  const excludedIds = objectIdList([req.user._id, ...blockedIds]);
  const search = cleanText(req.query.search, 80);
  const requestedFilter = cleanText(req.query.filter, 40).toLowerCase();
  const filter = DISCOVER_FILTERS.some((item) => item.id === requestedFilter) ? requestedFilter : "for_you";
  const limit = parseLimit(req.query.limit);
  const cursor = parseCursor(req.query.cursor);

  const profiles = await CreatorProfile.find({
    user: { $nin: excludedIds },
    profileVisibility: "public",
    "privacySettings.allowDiscovery": { $ne: false },
  })
    .populate({ path: "user", match: { role: { $in: ["fan", "creator"] }, status: "active", creatorApprovalStatus: "approved" }, select: "name username avatar isVerified role creatorApprovalStatus status createdAt lastSeenAt" })
    .sort({ updatedAt: -1 })
    .limit(80)
    .lean();

  const visibleProfiles = profiles.filter((profile) => profile.user);
  const creatorIds = visibleProfiles.map((profile) => profile.user._id);
  const [followerCounts, subscriberCounts, worldCounts, following, publications, seens, posts, stories, signalTargetIds, dreamByCreator] = await Promise.all([
    countsBy(ProfileRelationship, { target: { $in: creatorIds }, type: "FOLLOW" }, "target"),
    countsBy(Subscription, { creator: { $in: creatorIds }, status: { $in: ["active", "ACTIVE", "cancel_at_period_end", "CANCEL_AT_PERIOD_END"] } }, "creator"),
    countsBy(WorldEntitlement, { creator: { $in: creatorIds }, status: "ACTIVE" }, "creator"),
    ProfileRelationship.find({ actor: req.user._id, target: { $in: creatorIds }, type: "FOLLOW" }).select("target").lean(),
    Publication.find({ creator: { $in: creatorIds }, kind: { $in: ["WORLD", "PREMIUM_WORLD"] }, status: "PUBLISHED", publishedSnapshot: { $exists: true } })
      .sort({ publishedAt: -1, updatedAt: -1 })
      .limit(36)
      .populate("creator", "name username avatar isVerified")
      .lean(),
    Publication.find({ creator: { $in: creatorIds }, kind: "SEEN", status: "PUBLISHED", publishedSnapshot: { $exists: true } })
      .sort({ publishedAt: -1, updatedAt: -1 })
      .limit(12)
      .populate({ path: "creator", match: { role: { $in: ["fan", "creator"] }, status: "active", creatorApprovalStatus: "approved" }, select: "name username avatar isVerified role status creatorApprovalStatus" })
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
    activeSignalTargetIds(req.user._id),
    publicDreamByCreator(creatorIds),
  ]);

  const followingSet = new Set(following.map((item) => String(item.target)));
  const storyCreatorIds = new Set(stories.map((story) => String(story.creator?._id || story.creator)));
  const previewByCreator = new Map();
  for (const post of posts) {
    const url = (post.media || [])[0]?.url;
    if (!url) continue;
    const key = String(post.author);
    previewByCreator.set(key, [...(previewByCreator.get(key) || []), url].slice(0, 3));
  }

  const meta = { followerCounts, subscriberCounts, worldMemberCounts: worldCounts, followingSet, previewByCreator, storyCreatorIds };
  const publicationByCreator = new Map();
  for (const publication of publications) {
    const key = String(publication.creator?._id || publication.creator);
    if (!publicationByCreator.has(key)) publicationByCreator.set(key, publication);
  }
  const visibleSeens = seens.filter((seen) => seen.creator);
  const [worldsByPublication, entitledPublicationIds, savedOfferRows, seenEngagementCounts, connections] = await Promise.all([
    countsBy(WorldEntitlement, { publication: { $in: publications.map((item) => item._id) }, status: "ACTIVE" }, "publication"),
    entitlementIdsFor(req.user, publications),
    SeenEngagement.find({ user: req.user._id, publication: { $in: publications.map((item) => item._id) }, type: "SAVE" }).select("publication").lean(),
    countsBy(SeenEngagement, { publication: { $in: visibleSeens.map((item) => item._id) } }, "publication"),
    discoverConnections({ blockedIds, previewByCreator, viewerId: req.user._id }),
  ]);
  const savedPublicationIds = new Set(savedOfferRows.map((item) => String(item.publication)));
  const creators = visibleProfiles.map((profile, index) => serializeCreator(profile, { ...meta, reason: reasonFor(profile, index, viewerProfile) }));
  const searchedCreators = filterCreators(creators, search);
  const byFollowers = [...searchedCreators].sort((left, right) => right.followers - left.followers || new Date(right.updatedAt) - new Date(left.updatedAt));
  const byNewest = [...searchedCreators].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  const viewerCity = settings.preferredCity || viewerProfile?.city || "";
  const nearbyCreators = searchedCreators.filter((creator) => viewerCity && creator.city?.toLowerCase() === viewerCity.toLowerCase());
  const worlds = publications.map((publication) => serializeWorld(publication, { worldMemberCounts: worldsByPublication }));
  const viewerWalks = await SeenEngagement.find({ user: req.user._id, type: "WALKED" }).select("publication").lean();
  const walkedPublicationIds = viewerWalks.map((item) => item.publication);
  const sharedWalkRows = walkedPublicationIds.length ? await SeenEngagement.find({ publication: { $in: walkedPublicationIds }, user: { $in: creatorIds }, type: "WALKED" }).populate("publication", "title planet").populate("user", "name username avatar").limit(12).lean() : [];
  const sharedWalks = sharedWalkRows.map((item) => ({ id: item._id, world: { id: item.publication?._id, title: item.publication?.title, emoji: item.publication?.planet?.emoji || "🌍" }, person: { id: item.user?._id, name: item.user?.name, username: item.user?.username, avatar: item.user?.avatar || "" } }));
  const discoverSeens = visibleSeens.map((publication) => serializeDiscoverSeen(publication, seenEngagementCounts));
  const trendingSeen = [...discoverSeens]
    .sort((left, right) => right.viewCount - left.viewCount || new Date(right.publishedAt || 0) - new Date(left.publishedAt || 0))[0] || null;
  const freshSeens = discoverSeens
    .filter((seen) => seen.id !== trendingSeen?.id)
    .sort((left, right) => new Date(right.publishedAt || 0) - new Date(left.publishedAt || 0))
    .slice(0, 3);
  const categories = categoriesFromCreators(creators);
  const trendingTags = [...new Set([...creators.flatMap((creator) => creator.tags || []), ...DISCOVER_TAGS])].slice(0, 18);
  const interestTags = [...new Set([...(viewerProfile?.interests || []), ...(viewerProfile?.categories || []), viewerProfile?.category, ...DISCOVER_TAGS].filter(Boolean))].slice(0, 18);

  const slideMeta = {
    followerCounts,
    followingSet,
    publicationByCreator,
    publicationMemberCounts: worldsByPublication,
    previewByCreator,
    savedPublicationIds,
    signalTargetIds,
    subscriberCounts,
    settings,
    viewerCity,
    viewerCountry: cleanText(viewerProfile?.country, 80),
    viewerId: req.user._id,
    viewerProfile,
    viewerRole: req.user.role,
    worldMemberCounts: worldCounts,
    dreamByCreator,
    entitledPublicationIds,
  };
  const allSlides = visibleProfiles
    .map((profile, index) => ({ profile, slide: buildSlide(profile, index, slideMeta) }))
    .filter(({ slide }) => filterCreators([{
      name: slide.creator.name,
      username: slide.creator.username,
      category: slide.creator.category,
      location: [slide.creator.location.city, slide.creator.location.country].filter(Boolean).join(", "),
      bio: slide.quote,
      tags: slide.match.tags,
    }], search).length)
    .map(({ profile, slide }) => ({ slide, score: slideScore(profile, slideMeta) }))
    .sort((left, right) => right.score - left.score || left.slide.creator.name.localeCompare(right.slide.creator.name))
    .map((item) => item.slide);
  const filteredSlides = filterSlides(allSlides, filter, settings);
  const pageSlides = filteredSlides.slice(cursor, cursor + limit).map(publicSlide);
  const nextCursor = cursor + limit < filteredSlides.length ? String(cursor + limit) : null;

  return sendResponse(res, 200, "Discover fetched", {
    recommendations: pageSlides,
    pagination: {
      nextCursor,
      sessionId: req.query.sessionId || sessionIdFor(req.user._id, filter),
      hasMore: Boolean(nextCursor),
      limit,
      filter,
    },
    filters: DISCOVER_FILTERS,
    featuredCreators: byFollowers.slice(0, 1),
    recommendedCreators: searchedCreators.slice(0, 16),
    friends: connections.friends,
    following: connections.following,
    suggestedUsers: searchedCreators.filter((creator) => !creator.following).slice(0, 4),
    activity: serializeDiscoverActivity(visibleProfiles),
    trendingSeen,
    freshSeens,
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
    sharedWalks,
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

export const hideDiscoverCreator = asyncHandler(async (req, res) => {
  requireObjectId(req.params.userId, "creator id");
  if (String(req.params.userId) === String(req.user._id)) throw new ApiError(400, "You cannot hide yourself");
  const Model = roleProfileModel(req.user.role, req.user.creatorApprovalStatus);
  const updated = await Model.findOneAndUpdate(
    { user: req.user._id },
    { $addToSet: { "discoverSettings.hiddenCreators": req.params.userId }, $set: { "discoverSettings.updatedAt": new Date() } },
    { new: true },
  ).lean();
  return sendResponse(res, 200, "Creator hidden from Discover", { settings: discoverSettings(updated), hiddenCreatorId: String(req.params.userId) });
});

export const toggleDiscoverOfferSave = asyncHandler(async (req, res) => {
  requireObjectId(req.params.publicationId, "publication id");
  const publication = await Publication.findOne({
    _id: req.params.publicationId,
    kind: { $in: ["WORLD", "PREMIUM_WORLD", "SEEN"] },
    status: "PUBLISHED",
    publishedSnapshot: { $exists: true },
  }).select("_id kind status creator publishedSnapshot").lean();
  if (!publication) throw new ApiError(404, "Publication is not available");
  const filter = { publication: publication._id, user: req.user._id, type: "SAVE" };
  const existing = await SeenEngagement.findOne(filter);
  if (existing) await existing.deleteOne();
  else await SeenEngagement.create(filter);
  return sendResponse(res, 200, existing ? "Removed from Saved" : "Saved", {
    publicationId: String(publication._id),
    saved: !existing,
  });
});

function readReportInput(body = {}) {
  const reason = cleanText(body.reason || "OTHER", 40).toUpperCase();
  const details = cleanText(body.details, 1000);
  if (!REPORT_REASONS.has(reason)) throw new ApiError(400, "Select a valid report reason");
  return { reason, details };
}

export const reportDiscoverCreator = asyncHandler(async (req, res) => {
  requireObjectId(req.params.userId, "creator id");
  const profile = await CreatorProfile.findOne({
    user: req.params.userId,
    profileVisibility: "public",
    "privacySettings.allowDiscovery": { $ne: false },
  }).populate("user", "name username role status creatorApprovalStatus").lean();
  if (!profile?.user || profile.user.status !== "active") throw new ApiError(404, "Creator not found");
  const input = readReportInput(req.body);
  const report = await MessageReport.create({
    reporter: req.user._id,
    reportedUser: profile.user._id,
    scope: "CONVERSATION",
    ...input,
    snapshot: {
      source: "DISCOVER",
      reportedUserId: String(profile.user._id),
      username: profile.user.username,
      displayName: profile.user.name,
      reason: input.reason,
      details: input.details,
    },
  });
  return sendResponse(res, 201, "Report received", { reportId: String(report._id), status: report.status });
});

export const blockDiscoverCreator = asyncHandler(async (req, res) => {
  requireObjectId(req.params.userId, "creator id");
  if (String(req.params.userId) === String(req.user._id)) throw new ApiError(400, "You cannot block yourself");
  const profile = await CreatorProfile.findOne({ user: req.params.userId }).select("user").lean();
  if (!profile) throw new ApiError(404, "Creator not found");
  await UserBlock.updateOne(
    { blocker: req.user._id, blocked: req.params.userId },
    { $setOnInsert: { blocker: req.user._id, blocked: req.params.userId } },
    { upsert: true },
  );
  return sendResponse(res, 200, "Account blocked", { blockedUserId: String(req.params.userId), blockedByMe: true });
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
  const Model = roleProfileModel(req.user.role, req.user.creatorApprovalStatus);
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
  const Model = roleProfileModel(req.user.role, req.user.creatorApprovalStatus);
  const updated = await Model.findOneAndUpdate(
    { user: req.user._id },
    { $set: { discoverSettings: { ...DEFAULT_SETTINGS, updatedAt: new Date() } } },
    { new: true },
  ).lean();
  return sendResponse(res, 200, "Discover settings reset", { settings: discoverSettings(updated) });
});
