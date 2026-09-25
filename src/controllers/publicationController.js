import crypto from "node:crypto";
import Chapter from "../models/Chapter.js";
import AnalyticsEvent from "../models/AnalyticsEvent.js";
import CreatorProfile from "../models/CreatorProfile.js";
import DAWindow from "../models/DAWindow.js";
import mongoose from "mongoose";
import PremiumMembership from "../models/PremiumMembership.js";
import Publication from "../models/Publication.js";
import PublicationPreference from "../models/PublicationPreference.js";
import PublicationSeries from "../models/PublicationSeries.js";
import ProfileRelationship from "../models/ProfileRelationship.js";
import SeenEngagement, { SEEN_REACTIONS } from "../models/SeenEngagement.js";
import StarsLedgerEntry from "../models/StarsLedgerEntry.js";
import User from "../models/User.js";
import UserBlock from "../models/UserBlock.js";
import WorldEntitlement from "../models/WorldEntitlement.js";
import { attachEntityMetadata } from "../services/contentEntityService.js";
import { canAccessPublicationAudience, seenVisibilityFilter, serializePublication } from "../services/publicationAccessService.js";
import { addChapter, archivePublication, cancelPublishedRevision, createPublicationDraft, deletePlanet, deleteSeenPublication, ownerPublication, removeChapter, reorderChapters, resubmitPublication, startPublishedRevision, submitPublication, toggleSeenPinned, updateChapter, updatePublicationDraft } from "../services/publicationService.js";
import { deletePublicationFile, uploadPublicationFile, verifyPublicationAsset } from "../services/publicationMediaStorageService.js";
import { publicationEntitlement } from "../services/publicationEntitlementService.js";
import { serializePremiumWorldPricing, updatePremiumWorldPricing } from "../services/premiumWorldPricingService.js";
import { readCommentsEnabledSetting } from "../services/worldCommentsService.js";
import { env } from "../config/env.js";
import { MAX_MODERATORS_PER_EXPERIENCE, PREMIUM_PRICE_PRESETS, PREMIUM_WORLD_DEFAULT_CAPACITY, PREMIUM_WORLD_WAVE_SIZE, PUBLICATION_LIMITS, SEEN_CATEGORIES } from "../constants/publicationConstants.js";
import { safeUserProfile } from "../services/publicationModeratorService.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { getStarExchangeRate } from "../services/starExchangeService.js";

const page = (req) => ({ page: Math.max(1, Number(req.query.page) || 1), limit: Math.min(50, Math.max(1, Number(req.query.limit) || 20)) });
const shareUrlFor = (item) => item.visibility === "LINK_ONLY" && item.shareToken ? `${String(env.clientUrl || "").replace(/\/+$/u, "")}/seen/${item._id}?access=${encodeURIComponent(item.shareToken)}` : null;
const normalizeSeriesName = (value) => String(value || "").trim().replace(/\s+/g, " ").slice(0, PUBLICATION_LIMITS.seriesName);
const normalizeSeriesKey = (value) => normalizeSeriesName(value).toLowerCase();
const normalizeSeriesDescription = (value) => String(value || "").trim().slice(0, PUBLICATION_LIMITS.description);
const seenReactionOrder = new Map(SEEN_REACTIONS.map((reaction, index) => [reaction, index]));
const sortSeenReactionRows = (rows = []) => rows.sort((first, second) => second.count - first.count || (seenReactionOrder.get(first._id.reaction) ?? 100) - (seenReactionOrder.get(second._id.reaction) ?? 100) || String(first._id.reaction).localeCompare(String(second._id.reaction)));
const ownerView = (publication, chapters, user) => { const item = publication.toObject ? publication.toObject() : publication; if (!item.submittedSnapshot || ["DRAFT", "CHANGES_REQUESTED"].includes(item.status)) item.submittedSnapshot = { metadata: item, chapters, version: item.draftVersion, frozenAt: new Date() }; return serializePublication(item, user); };
const safeSeriesMedia = (media) => media?.secureUrl ? { assetId: media.assetId, mediaType: media.mediaType, resourceType: media.resourceType, format: media.format, bytes: media.bytes, width: media.width, height: media.height, duration: media.duration, secureUrl: media.secureUrl } : null;
const serializeSeriesSeen = (item) => ({ id: String(item._id || item.id), title: item.title || "Untitled Seen", summary: item.summary || "", coverMedia: safeSeriesMedia(item.coverMedia), chapterCount: item.chapters?.length || item.chapterCount || 0, status: item.status, publishedAt: item.publishedAt, updatedAt: item.updatedAt });
const serializeSeries = (series, seens = []) => {
  const previewSeens = seens.slice(0, 4).map(serializeSeriesSeen);
  return { id: String(series._id || series.id), name: series.name, title: series.name, description: series.description || "", coverMedia: safeSeriesMedia(series.coverMedia) || previewSeens.find((item) => item.coverMedia)?.coverMedia || null, seenCount: seens.length, previewSeens, isPinned: Boolean(series.isPinned), sortOrder: Number(series.sortOrder || 0), createdAt: series.createdAt, updatedAt: series.updatedAt };
};
const ensureSeriesId = (id) => { if (!mongoose.isValidObjectId(id)) throw new ApiError(400, "Invalid Series ID"); };
const ensureSeenId = (id) => { if (!mongoose.isValidObjectId(id)) throw new ApiError(400, "Invalid Seen ID"); };
const ensurePublicationId = (id) => { if (!mongoose.isValidObjectId(id)) throw new ApiError(400, "Invalid publication ID"); };
const ownerSeries = async (creatorId, id) => { ensureSeriesId(id); const series = await PublicationSeries.findOne({ _id: id, creator: creatorId, archivedAt: null }); if (!series) throw new ApiError(404, "Series not found"); return series; };
const ownerSeen = async (creatorId, id) => { ensureSeenId(id); const seen = await Publication.findOne({ _id: id, creator: creatorId, kind: "SEEN", status: { $ne: "REMOVED" } }); if (!seen) throw new ApiError(404, "Seen not found"); return seen; };
const ownerWorld = async (creatorId, id) => { ensurePublicationId(id); const publication = await Publication.findOne({ _id: id, creator: creatorId, kind: { $in: ["WORLD", "PREMIUM_WORLD", "EXPERIENCE"] }, status: { $ne: "REMOVED" } }).select("+submittedSnapshot +shareToken"); if (!publication) throw new ApiError(404, "Experience not found"); return publication; };
const visibleSeriesSeenFilter = (seriesId, viewer, series) => {
  const owner = viewer?._id && String(viewer._id) === String(series.creator?._id || series.creator);
  return { series: seriesId, kind: "SEEN", status: owner ? { $in: ["DRAFT", "CHANGES_REQUESTED", "PUBLISHED"] } : { $in: ["PUBLISHED", "CHANGES_REQUESTED"] }, ...(owner ? {} : { publishedSnapshot: { $exists: true } }) };
};
const monthAgo = () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
const weekAgo = () => new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
const dayBucket = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const updateSnapshotMetadata = (publication, values) => {
  for (const snapshotKey of ["submittedSnapshot", "publishedSnapshot"]) {
    if (!publication[snapshotKey]?.metadata) continue;
    publication[snapshotKey].metadata = { ...publication[snapshotKey].metadata, ...values };
    publication.markModified(`${snapshotKey}.metadata`);
  }
};
const premiumWorldForCreator = (creatorId) => Publication.findOne({ creator: creatorId, kind: "PREMIUM_WORLD", status: { $in: ["DRAFT", "PENDING_REVIEW", "CHANGES_REQUESTED", "PUBLISHED"] } }).select("+submittedSnapshot");
async function syncExperienceWithPremiumWorld(creatorId, experienceId, included, premiumWorld = null) {
  const world = premiumWorld || await premiumWorldForCreator(creatorId);
  if (!world) {
    if (included) throw new ApiError(409, "Create your Premium World before including this Experience");
    return;
  }
  const ids = (world.includedExperienceIds || []).map(String);
  world.includedExperienceIds = included
    ? [...new Set([...ids, String(experienceId)])]
    : ids.filter((id) => id !== String(experienceId));
  world.statusVersion += 1;
  updateSnapshotMetadata(world, { includedExperienceIds: world.includedExperienceIds });
  await world.save();
}
const snapshotChapter = (chapter) => ({
  stableChapterId: chapter.stableChapterId,
  order: chapter.order,
  title: chapter.title,
  blocks: chapter.blocks.map((block) => (block.toObject ? block.toObject() : block)),
  isPreview: chapter.isPreview,
  releaseMode: chapter.releaseMode,
  releaseAt: chapter.releaseAt,
  draftVersion: chapter.draftVersion,
});
const upsertSnapshotChapter = (publication, chapter) => {
  const nextChapter = snapshotChapter(chapter);
  for (const snapshotKey of ["submittedSnapshot", "publishedSnapshot"]) {
    if (!publication[snapshotKey]?.chapters) continue;
    const chapters = publication[snapshotKey].chapters || [];
    const index = chapters.findIndex((item) => item.stableChapterId === chapter.stableChapterId);
    publication[snapshotKey].chapters = index >= 0
      ? chapters.map((item, itemIndex) => itemIndex === index ? nextChapter : item)
      : [...chapters, nextChapter].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
    publication.markModified(`${snapshotKey}.chapters`);
  }
};
const activeMembershipFilter = (publicationId) => ({ premiumPublication: publicationId, status: { $in: ["ACTIVE", "CANCEL_AT_PERIOD_END"] }, currentPeriodEnd: { $gt: new Date() } });
async function serializeWorldManagement(publication, user) {
  const publicationId = publication._id;
  const now = new Date();
  const sinceWeek = weekAgo();
  const [chapters, residentCount, membershipRows, directAccessWaiting, engagementRows, dailyEngagementRows, ledgerRows, analyticsRows, includedExperiences, moderators] = await Promise.all([
    Chapter.find({ publication: publicationId }).sort({ order: 1 }).lean(),
    PremiumMembership.countDocuments(activeMembershipFilter(publicationId)),
    PremiumMembership.aggregate([{ $match: activeMembershipFilter(publicationId) }, { $group: { _id: null, recurringStars: { $sum: "$starsPerPeriod" } } }]),
    DAWindow.countDocuments({ creator: publication.creator, settlementStatus: "HELD", status: { $in: ["OPEN", "ANSWERED", "CLOSED"] } }),
    SeenEngagement.aggregate([{ $match: { publication: publicationId } }, { $group: { _id: "$type", count: { $sum: 1 } } }]),
    SeenEngagement.aggregate([{ $match: { publication: publicationId, createdAt: { $gte: sinceWeek } } }, { $group: { _id: { type: "$type", day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } } }, count: { $sum: 1 } } }]),
    StarsLedgerEntry.aggregate([{ $match: { accountUser: publication.creator, publication: publicationId, direction: "CREDIT", entryType: { $in: ["PREMIUM_CREATOR_EARNING", "WORLD_CREATOR_EARNING"] }, createdAt: { $gte: monthAgo() } } }, { $group: { _id: "$entryType", stars: { $sum: "$starsAmount" } } }]),
    AnalyticsEvent.aggregate([{ $match: { entityId: String(publicationId), entityType: { $in: ["world", "publication", "seen"] }, createdAt: { $gte: sinceWeek } } }, { $group: { _id: { eventType: "$eventType", day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } } }, count: { $sum: 1 }, users: { $addToSet: "$userId" } } }]),
    publication.includedExperienceIds?.length ? Publication.find({ _id: { $in: publication.includedExperienceIds }, creator: publication.creator, kind: "EXPERIENCE", status: { $ne: "REMOVED" } }).lean() : [],
    publication.worldModerators?.length ? User.find({ _id: { $in: publication.worldModerators.map((item) => item.user) } }).select("name username avatar isVerified").lean() : [],
  ]);
  const engagement = Object.fromEntries(engagementRows.map((row) => [row._id, row.count]));
  const ledger = Object.fromEntries(ledgerRows.map((row) => [row._id, row.stars]));
  const todayKey = new Date().toISOString().slice(0, 10);
  const daily = Array.from({ length: 7 }, (_, index) => {
    const day = dayBucket(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (6 - index)));
    const key = day.toISOString().slice(0, 10);
    const engagementViews = dailyEngagementRows.filter((row) => row._id.day === key && ["WALKED", "SHARE", "COMMENT", "SAVE", "REACTION"].includes(row._id.type)).reduce((sum, row) => sum + row.count, 0);
    const analyticsViews = analyticsRows.filter((row) => row._id.day === key && ["CONTENT_IMPRESSION", "CONTENT_OPENED", "CONTENT_VIEW", "SEEN_VIEW"].includes(row._id.eventType)).reduce((sum, row) => sum + row.count, 0);
    return { date: key, views: engagementViews + analyticsViews, current: key === todayKey };
  });
  const serialized = ownerView(publication, chapters, user);
  const capacity = publication.worldSeatCapacity ?? PREMIUM_WORLD_DEFAULT_CAPACITY;
  const recurringStars = membershipRows[0]?.recurringStars || 0;
  return {
    publication: serialized,
    management: {
      seatStatus: {
        foundingCapacity: publication.worldFoundingCapacity || PREMIUM_WORLD_DEFAULT_CAPACITY,
        occupiedSeats: residentCount,
        capacity,
        unlimited: publication.worldSeatCapacity === null,
        waitingListCount: 0,
        waitingListAvailable: false,
        waveSize: publication.worldWaveSize || PREMIUM_WORLD_WAVE_SIZE,
      },
      subscription: {
        priceStars: publication.pricing?.starsAmount || null,
        pricePresets: PREMIUM_PRICE_PRESETS,
        memberPriceLocked: publication.memberPriceLocked !== false,
        firstMonthOfferEnabled: Boolean(publication.firstMonthOfferEnabled),
        directAccessIncluded: publication.directAccessIncluded !== false,
        directAccessIncludedReplies: Number(publication.directAccessIncludedReplies || 1),
      },
      directAccess: { waiting: directAccessWaiting, memberPriority: true, includedReplies: Number(publication.directAccessIncludedReplies || 1) },
      comments: { enabled: publication.commentsEnabled !== false, count: engagement.COMMENT || 0 },
      stories: { previewLimit: 3, freePreviewCount: chapters.filter((chapter) => chapter.isPreview).length, items: chapters },
      includedExperiences: includedExperiences.map((item) => ({ id: String(item._id), title: item.title, summary: item.summary, coverMedia: item.coverMedia || null, chapterCount: item.publishedSnapshot?.chapters?.length || item.submittedSnapshot?.chapters?.length || 0, pricing: item.pricing, included: true })),
      moderators: moderators.map(safeUserProfile).filter(Boolean),
      moderatorLimit: MAX_MODERATORS_PER_EXPERIENCE,
      analytics: {
        supported: true,
        daily,
        views: (engagement.WALKED || 0) + (engagement.REACTION || 0) + (engagement.COMMENT || 0) + (engagement.SHARE || 0) + (engagement.SAVE || 0),
        todayViews: daily.find((item) => item.current)?.views || 0,
        residents: residentCount,
        shares: engagement.SHARE || 0,
        comments: engagement.COMMENT || 0,
        grossRevenueStars30d: (ledger.PREMIUM_CREATOR_EARNING || 0) + (ledger.WORLD_CREATOR_EARNING || 0),
        creatorEarningsStars30d: (ledger.PREMIUM_CREATOR_EARNING || 0) + (ledger.WORLD_CREATOR_EARNING || 0),
        estimatedRecurringStars: recurringStars,
        readToEnd: null,
        stayOnRate: null,
      },
    },
  };
}
export const listMine = asyncHandler(async (req, res) => { const paging = page(req); const filter = { creator: req.user._id }; if (req.query.kind) filter.kind = req.query.kind.includes(",") ? { $in: req.query.kind.split(",") } : req.query.kind; if (req.query.status) filter.status = req.query.status; const [items, total] = await Promise.all([Publication.find(filter).select("+shareToken").populate("series", "name").sort({ updatedAt: -1 }).skip((paging.page - 1) * paging.limit).limit(paging.limit).lean(), Publication.countDocuments(filter)]); const publicationIds = items.map((item) => item._id); const [counts, residentRows, ownerRows] = await Promise.all([Chapter.aggregate([{ $match: { publication: { $in: publicationIds } } }, { $group: { _id: "$publication", count: { $sum: 1 }, previewCount: { $sum: { $cond: ["$isPreview", 1, 0] } } } }]), PremiumMembership.aggregate([{ $match: { creator: req.user._id, premiumPublication: { $in: publicationIds }, status: { $in: ["ACTIVE", "CANCEL_AT_PERIOD_END"] }, currentPeriodEnd: { $gt: new Date() } } }, { $group: { _id: "$premiumPublication", residentCount: { $sum: 1 }, monthlyStars: { $sum: "$starsPerPeriod" } } }]), WorldEntitlement.aggregate([{ $match: { publication: { $in: publicationIds }, status: "ACTIVE" } }, { $group: { _id: "$publication", ownerCount: { $sum: 1 } } }])]); const chapterCounts = new Map(counts.map((entry) => [String(entry._id), entry])); const residentCounts = new Map(residentRows.map((entry) => [String(entry._id), entry])); const ownerCounts = new Map(ownerRows.map((entry) => [String(entry._id), Number(entry.ownerCount) || 0])); return sendResponse(res, 200, "Publications fetched", { items: items.map((item) => { const residents = residentCounts.get(String(item._id)); return { id: item._id, kind: item.kind, title: item.title, summary: item.summary, category: item.category, series: item.series ? { id: String(item.series._id), name: item.series.name } : null, seriesId: item.series?._id ? String(item.series._id) : null, visibility: item.visibility || "PUBLIC", shareUrl: shareUrlFor(item), coverMedia: item.coverMedia ? { mediaType: item.coverMedia.mediaType, format: item.coverMedia.format, width: item.coverMedia.width, height: item.coverMedia.height, secureUrl: item.coverMedia.secureUrl } : null, chapterCount: chapterCounts.get(String(item._id))?.count || 0, previewCount: chapterCounts.get(String(item._id))?.previewCount || 0, ownerCount: ownerCounts.get(String(item._id)) || 0, residentCount: residents?.residentCount || 0, monthlyStars: residents?.monthlyStars || 0, pricing: item.pricing, planet: item.planet, status: item.status, statusVersion: item.statusVersion, draftVersion: item.draftVersion, submittedAt: item.submittedAt, publishedAt: item.publishedAt, archivedAt: item.archivedAt, createdAt: item.createdAt, updatedAt: item.updatedAt }; }), pagination: { ...paging, total, pages: Math.max(1, Math.ceil(total / paging.limit)) } }); });
export const getMine = asyncHandler(async (req, res) => { const { publication, chapters } = await ownerPublication(req.user._id, req.params.id); await attachEntityMetadata(publication, req.user); return sendResponse(res, 200, "Publication fetched", { publication: ownerView(publication, chapters, req.user) }); });
export const getWorldManagement = asyncHandler(async (req, res) => {
  const publication = await ownerWorld(req.user._id, req.params.id);
  await attachEntityMetadata(publication, req.user);
  return sendResponse(res, 200, "World management fetched", await serializeWorldManagement(publication, req.user));
});
export const getWorldPricing = asyncHandler(async (req, res) => {
  const publication = await ownerWorld(req.user._id, req.params.id);
  return sendResponse(res, 200, "World pricing fetched", { pricing: await serializePremiumWorldPricing(publication) });
});
export const updateWorldPricing = asyncHandler(async (req, res) => {
  const monthlyStars = req.body.monthlyStars ?? req.body.monthlyCoins ?? req.body.priceStars;
  const { publication, pricing } = await updatePremiumWorldPricing({ creatorId: req.user._id, publicationId: req.params.id, monthlyStars });
  await attachEntityMetadata(publication, req.user);
  return sendResponse(res, 200, "World price updated", { ...(await serializeWorldManagement(publication, req.user)), pricing });
});
export const updateWorldManagement = asyncHandler(async (req, res) => {
  const publication = await ownerWorld(req.user._id, req.params.id);
  const updates = {};
  let premiumWorld = null;
  if (Object.hasOwn(req.body, "priceStars") || Object.hasOwn(req.body, "monthlyStars") || Object.hasOwn(req.body, "monthlyCoins")) {
    throw new ApiError(400, "Use the World pricing endpoint to change subscription price", "WORLD_PRICING_ENDPOINT_REQUIRED");
  }
  if (Object.hasOwn(req.body, "title") || Object.hasOwn(req.body, "name")) {
    const title = String(req.body.title ?? req.body.name ?? "").trim().replace(/\s+/g, " ");
    if (!title || title.length > 30) throw new ApiError(400, "World name must be between 1 and 30 characters");
    updates.title = title;
  }
  if (Object.hasOwn(req.body, "description")) updates.description = String(req.body.description || "").trim().slice(0, PUBLICATION_LIMITS.description);
  if (Object.hasOwn(req.body, "planetFaceEmoji") || Object.hasOwn(req.body, "planetEmoji")) {
    const emoji = String(req.body.planetFaceEmoji ?? req.body.planetEmoji ?? "").trim();
    if (!emoji || emoji.length > 16) throw new ApiError(400, "Choose one planet face emoji");
    updates["planet.faceEmoji"] = emoji;
  }
  const commentsEnabled = readCommentsEnabledSetting(req.body);
  if (commentsEnabled !== undefined) updates.commentsEnabled = commentsEnabled;
  if (Object.hasOwn(req.body, "firstMonthOfferEnabled")) updates.firstMonthOfferEnabled = req.body.firstMonthOfferEnabled === true;
  if (Object.hasOwn(req.body, "directAccessIncluded")) updates.directAccessIncluded = req.body.directAccessIncluded === true;
  if (Object.hasOwn(req.body, "directAccessIncludedReplies")) {
    const replies = Number(req.body.directAccessIncludedReplies);
    if (!Number.isSafeInteger(replies) || replies < 0 || replies > 3) throw new ApiError(400, "Included replies must be between 0 and 3");
    updates.directAccessIncludedReplies = replies;
  }
  if (Object.hasOwn(req.body, "allowDownload")) updates.allowDownload = req.body.allowDownload === true;
  if (Object.hasOwn(req.body, "includedInWorld")) {
    updates.includedInWorld = req.body.includedInWorld === true;
    if (publication.kind !== "EXPERIENCE") throw new ApiError(400, "Only Experiences can be included in a Premium World");
    premiumWorld = await premiumWorldForCreator(req.user._id);
    if (updates.includedInWorld && !premiumWorld) throw new ApiError(409, "Create your Premium World before including this Experience");
  }
  if (Object.hasOwn(req.body, "taggedPeople")) {
    if (publication.kind !== "EXPERIENCE") throw new ApiError(400, "People can only be tagged in an Experience");
    const taggedPeople = [...new Set((Array.isArray(req.body.taggedPeople) ? req.body.taggedPeople : []).map(String))];
    if (taggedPeople.length > 10 || taggedPeople.some((id) => !mongoose.isValidObjectId(id) || id === String(req.user._id))) throw new ApiError(400, "Choose up to 10 valid people");
    const existingCount = await User.countDocuments({ _id: { $in: taggedPeople }, role: { $in: ["fan", "creator"] }, status: "active" });
    if (existingCount !== taggedPeople.length) throw new ApiError(400, "One or more tagged people are unavailable");
    updates.taggedPeople = taggedPeople;
  }
  if (!Object.keys(updates).length) return sendResponse(res, 200, "World unchanged", await serializeWorldManagement(publication, req.user));
  const planetFaceEmoji = updates["planet.faceEmoji"];
  delete updates["planet.faceEmoji"];
  Object.assign(publication, updates);
  if (planetFaceEmoji) {
    publication.set("planet.faceEmoji", planetFaceEmoji);
    if (!publication.planet?.emoji) publication.set("planet.emoji", "🪐");
  }
  publication.statusVersion += 1;
  const snapshotUpdates = { ...updates };
  if (planetFaceEmoji) snapshotUpdates.planet = { ...(publication.planet?.toObject?.() || publication.planet || {}), faceEmoji: planetFaceEmoji, emoji: publication.planet?.emoji || "🪐" };
  if (updates.title || updates.description || updates.pricing || planetFaceEmoji || Object.hasOwn(updates, "commentsEnabled") || Object.hasOwn(updates, "firstMonthOfferEnabled") || Object.hasOwn(updates, "directAccessIncluded") || Object.hasOwn(updates, "directAccessIncludedReplies") || Object.hasOwn(updates, "allowDownload") || Object.hasOwn(updates, "includedInWorld") || Object.hasOwn(updates, "taggedPeople")) updateSnapshotMetadata(publication, snapshotUpdates);
  await publication.save();
  if (Object.hasOwn(updates, "includedInWorld")) await syncExperienceWithPremiumWorld(req.user._id, publication._id, updates.includedInWorld, premiumWorld);
  await attachEntityMetadata(publication, req.user);
  return sendResponse(res, 200, "World updated", await serializeWorldManagement(publication, req.user));
});
export const uploadWorldCover = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, "Cover image is required");
  const publication = await ownerWorld(req.user._id, req.params.id);
  const mediaType = String(req.file.mimetype || "").startsWith("video/") ? "VIDEO" : "IMAGE";
  if (mediaType !== "IMAGE") throw new ApiError(400, "World covers must be images");
  const uploaded = await uploadPublicationFile({ file: req.file, creatorId: req.user._id, publicationId: publication._id, chapterId: "root", blockId: "cover", mediaType });
  const trusted = await verifyPublicationAsset({ assetId: uploaded.assetId, creatorId: req.user._id, publicationId: publication._id, chapterId: "root", blockId: "cover", mediaType });
  publication.coverMedia = trusted;
  publication.statusVersion += 1;
  updateSnapshotMetadata(publication, { coverMedia: trusted });
  await publication.save();
  await attachEntityMetadata(publication, req.user);
  return sendResponse(res, 201, "World cover updated", await serializeWorldManagement(publication, req.user));
});
export const uploadWorldStoryPreview = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, "Story image is required");
  const publication = await ownerWorld(req.user._id, req.params.id);
  const mediaType = String(req.file.mimetype || "").startsWith("video/") ? "VIDEO" : "IMAGE";
  if (mediaType !== "IMAGE") throw new ApiError(400, "World stories currently support images");

  let chapter = await Chapter.findOne({ publication: publication._id, isPreview: true }).sort({ order: 1 });
  if (!chapter) {
    const count = await Chapter.countDocuments({ publication: publication._id });
    chapter = await Chapter.create({
      publication: publication._id,
      stableChapterId: crypto.randomUUID(),
      order: count,
      title: "Chapter 1",
      isPreview: true,
      releaseMode: "IMMEDIATE",
      blocks: [],
    });
  }

  const existingStoryCount = (chapter.blocks || []).filter((block) => block.metadata?.storyPreview && block.media?.secureUrl).length;
  if (existingStoryCount >= 3) throw new ApiError(409, "Worlds can show up to 3 preview stories");

  const blockId = crypto.randomUUID();
  const uploaded = await uploadPublicationFile({ file: req.file, creatorId: req.user._id, publicationId: publication._id, chapterId: chapter.stableChapterId, blockId, mediaType });
  const trusted = await verifyPublicationAsset({ assetId: uploaded.assetId, creatorId: req.user._id, publicationId: publication._id, chapterId: chapter.stableChapterId, blockId, mediaType });
  chapter.blocks.push({
    id: blockId,
    media: trusted,
    metadata: { caption: String(req.body.caption || "").slice(0, 300), label: req.body.label || `Story ${existingStoryCount + 1}`, storyPreview: true },
    order: chapter.blocks.length,
    text: "",
    type: "IMAGE",
  });
  chapter.draftVersion += 1;
  await chapter.save();

  publication.statusVersion += 1;
  publication.draftVersion += 1;
  upsertSnapshotChapter(publication, chapter);
  await publication.save();
  await attachEntityMetadata(publication, req.user);
  return sendResponse(res, 201, "World story added", await serializeWorldManagement(publication, req.user));
});
export const includeWorldExperience = asyncHandler(async (req, res) => {
  const publication = await ownerWorld(req.user._id, req.params.id);
  ensurePublicationId(req.params.experienceId);
  const experience = await Publication.findOne({ _id: req.params.experienceId, creator: req.user._id, kind: "EXPERIENCE", status: { $ne: "REMOVED" } }).select("+submittedSnapshot");
  if (!experience) throw new ApiError(404, "Experience not found");
  if (publication.includedExperienceIds.map(String).includes(String(experience._id))) throw new ApiError(409, "Experience is already included");
  publication.includedExperienceIds.push(experience._id);
  publication.statusVersion += 1;
  updateSnapshotMetadata(publication, { includedExperienceIds: publication.includedExperienceIds });
  await publication.save();
  experience.includedInWorld = true;
  experience.statusVersion += 1;
  updateSnapshotMetadata(experience, { includedInWorld: true });
  await experience.save();
  return sendResponse(res, 200, "Experience included", await serializeWorldManagement(publication, req.user));
});
export const removeWorldExperience = asyncHandler(async (req, res) => {
  const publication = await ownerWorld(req.user._id, req.params.id);
  ensurePublicationId(req.params.experienceId);
  publication.includedExperienceIds = publication.includedExperienceIds.filter((item) => String(item) !== String(req.params.experienceId));
  publication.statusVersion += 1;
  updateSnapshotMetadata(publication, { includedExperienceIds: publication.includedExperienceIds });
  await publication.save();
  const experience = await Publication.findOne({ _id: req.params.experienceId, creator: req.user._id, kind: "EXPERIENCE" }).select("+submittedSnapshot");
  if (experience) {
    experience.includedInWorld = false;
    experience.statusVersion += 1;
    updateSnapshotMetadata(experience, { includedInWorld: false });
    await experience.save();
  }
  return sendResponse(res, 200, "Experience removed", await serializeWorldManagement(publication, req.user));
});
export const openWorldWave = asyncHandler(async (req, res) => {
  const publication = await ownerWorld(req.user._id, req.params.id);
  const previousCapacity = publication.worldSeatCapacity ?? PREMIUM_WORLD_DEFAULT_CAPACITY;
  const waveSize = publication.worldWaveSize || PREMIUM_WORLD_WAVE_SIZE;
  const nextCapacity = previousCapacity + waveSize;
  publication.worldSeatCapacity = nextCapacity;
  publication.worldWaves.push({ openedBy: req.user._id, previousCapacity, nextCapacity });
  publication.statusVersion += 1;
  updateSnapshotMetadata(publication, { worldSeatCapacity: nextCapacity, worldWaveSize: waveSize });
  await publication.save();
  return sendResponse(res, 200, "World wave opened", await serializeWorldManagement(publication, req.user));
});

export const listWorldModerators = asyncHandler(async (req, res) => {
  const publication = await ownerWorld(req.user._id, req.params.id);
  const moderators = publication.worldModerators?.length
    ? await User.find({ _id: { $in: publication.worldModerators.map((item) => item.user) } }).select("name username avatar isVerified").lean()
    : [];
  return sendResponse(res, 200, "Moderators fetched", {
    moderators: moderators.map(safeUserProfile).filter(Boolean),
    limit: MAX_MODERATORS_PER_EXPERIENCE,
    count: moderators.length,
  });
});

export const listWorldModeratorCandidates = asyncHandler(async (req, res) => {
  const publication = await ownerWorld(req.user._id, req.params.id);
  const excluded = [publication.creator, ...(publication.worldModerators || []).map((item) => item.user)].filter(Boolean);
  const query = String(req.query.q || "").trim();
  const filter = {
    _id: { $nin: excluded },
    role: { $in: ["fan", "creator"] },
    status: "active",
    deletionRequestedAt: null,
  };
  if (query) filter.$or = [
    { name: { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } },
    { username: { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } },
  ];
  const candidates = await User.find(filter).select("name username avatar isVerified").sort({ isVerified: -1, name: 1, username: 1 }).limit(24).lean();
  return sendResponse(res, 200, "Moderator candidates fetched", {
    candidates: candidates.map(safeUserProfile).filter(Boolean),
    limit: MAX_MODERATORS_PER_EXPERIENCE,
    remaining: Math.max(0, MAX_MODERATORS_PER_EXPERIENCE - (publication.worldModerators || []).length),
  });
});

export const addWorldModerator = asyncHandler(async (req, res) => {
  const moderatorId = req.body.userId || req.params.userId;
  ensurePublicationId(moderatorId);
  const publication = await ownerWorld(req.user._id, req.params.id);
  if (String(moderatorId) === String(req.user._id)) throw new ApiError(400, "You already own this World");
  if (publication.worldModerators.length >= MAX_MODERATORS_PER_EXPERIENCE) throw new ApiError(409, `An experience can have up to ${MAX_MODERATORS_PER_EXPERIENCE} moderators`);
  if (publication.worldModerators.some((item) => String(item.user) === String(moderatorId))) throw new ApiError(409, "Moderator already added");
  const moderator = await User.findOne({ _id: moderatorId, role: { $in: ["fan", "creator"] }, status: "active" }).select("_id");
  if (!moderator) throw new ApiError(404, "User not found");
  const updated = await Publication.findOneAndUpdate(
    {
      _id: publication._id,
      creator: req.user._id,
      kind: { $in: ["WORLD", "PREMIUM_WORLD", "EXPERIENCE"] },
      "worldModerators.user": { $ne: moderator._id },
      $expr: { $lt: [{ $size: { $ifNull: ["$worldModerators", []] } }, MAX_MODERATORS_PER_EXPERIENCE] },
    },
    { $push: { worldModerators: { user: moderator._id, addedBy: req.user._id, addedAt: new Date() } }, $inc: { statusVersion: 1 } },
    { new: true, runValidators: true },
  ).select("+submittedSnapshot +shareToken");
  if (!updated) {
    const fresh = await ownerWorld(req.user._id, req.params.id);
    if (fresh.worldModerators.some((item) => String(item.user) === String(moderatorId))) throw new ApiError(409, "Moderator already added");
    if (fresh.worldModerators.length >= MAX_MODERATORS_PER_EXPERIENCE) throw new ApiError(409, `An experience can have up to ${MAX_MODERATORS_PER_EXPERIENCE} moderators`);
    throw new ApiError(409, "Moderator could not be added");
  }
  updateSnapshotMetadata(updated, { worldModerators: updated.worldModerators });
  await updated.save();
  return sendResponse(res, 200, "Moderator added", await serializeWorldManagement(updated, req.user));
});
export const removeWorldModerator = asyncHandler(async (req, res) => {
  const publication = await ownerWorld(req.user._id, req.params.id);
  ensurePublicationId(req.params.userId);
  const before = publication.worldModerators.length;
  publication.worldModerators = publication.worldModerators.filter((item) => String(item.user) !== String(req.params.userId));
  if (publication.worldModerators.length === before) throw new ApiError(404, "Moderator not found for this experience");
  publication.statusVersion += 1;
  updateSnapshotMetadata(publication, { worldModerators: publication.worldModerators });
  await publication.save();
  return sendResponse(res, 200, "Moderator removed", await serializeWorldManagement(publication, req.user));
});
export const createDraft = asyncHandler(async (req, res) => { const publication = await createPublicationDraft(req.user._id, req.body); await publication.populate("series", "name"); await attachEntityMetadata(publication, req.user); return sendResponse(res, 201, "Publication draft created", { publication: ownerView(publication, [], req.user) }); });
export const updateDraft = asyncHandler(async (req, res) => { const publication = await updatePublicationDraft(req.user._id, req.params.id, req.body); await publication.populate("series", "name"); const chapters = await Chapter.find({ publication: publication._id }).sort({ order: 1 }).lean(); await attachEntityMetadata(publication, req.user); return sendResponse(res, 200, "Publication updated", { publication: ownerView(publication, chapters, req.user) }); });
export const listSeenCategories = asyncHandler(async (req, res) => sendResponse(res, 200, "Seen categories fetched", { categories: SEEN_CATEGORIES.map((name) => ({ id: name, name })) }));
export const listMySeries = asyncHandler(async (req, res) => { const items = await PublicationSeries.find({ creator: req.user._id, archivedAt: null }).sort({ isPinned: -1, sortOrder: 1, updatedAt: -1, name: 1 }).lean(); const seens = await Publication.find({ creator: req.user._id, kind: "SEEN", series: { $in: items.map((item) => item._id) }, status: { $ne: "REMOVED" } }).sort({ publishedAt: -1, updatedAt: -1 }).lean(); const bySeries = new Map(); for (const seen of seens) bySeries.set(String(seen.series), [...(bySeries.get(String(seen.series)) || []), seen]); return sendResponse(res, 200, "Series fetched", { items: items.map((item) => serializeSeries(item, bySeries.get(String(item._id)) || [])) }); });
export const createSeries = asyncHandler(async (req, res) => { const name = normalizeSeriesName(req.body.name || req.body.title); if (!name) throw new ApiError(400, "Series name is required"); const normalizedName = normalizeSeriesKey(name); if (await PublicationSeries.exists({ creator: req.user._id, normalizedName, archivedAt: null })) throw new ApiError(409, "You already have a Series with that name"); try { const series = await PublicationSeries.create({ creator: req.user._id, name, normalizedName, description: normalizeSeriesDescription(req.body.description), coverMedia: req.body.coverMedia?.secureUrl ? req.body.coverMedia : undefined }); return sendResponse(res, 201, "Series saved", { series: serializeSeries(series, []) }); } catch (error) { if (error?.code === 11000) throw new ApiError(409, "You already have a Series with that name"); throw error; } });
export const getSeries = asyncHandler(async (req, res) => { ensureSeriesId(req.params.seriesId); const series = await PublicationSeries.findOne({ _id: req.params.seriesId, archivedAt: null }).populate("creator", "name username avatar isVerified").lean(); if (!series) throw new ApiError(404, "Series not found"); const owner = req.user?._id && String(req.user._id) === String(series.creator?._id || series.creator); const visibility = owner ? {} : await seenVisibilityFilter(req.user || null, [series.creator?._id || series.creator]); const seens = await Publication.find({ ...visibleSeriesSeenFilter(series._id, req.user || null, series), ...visibility }).select("+submittedSnapshot").populate("creator", "name username avatar isVerified").populate("series", "name").sort({ publishedAt: -1, updatedAt: -1 }).lean(); return sendResponse(res, 200, "Series fetched", { series: { ...serializeSeries(series, seens), owner: series.creator?._id ? { id: String(series.creator._id), name: series.creator.name, username: series.creator.username, avatar: series.creator.avatar || "", verified: Boolean(series.creator.isVerified) } : null, seens: seens.map((item) => serializePublication(item, owner ? req.user : null, { audienceAllowed: true })).filter(Boolean) } }); });
export const updateSeries = asyncHandler(async (req, res) => { const series = await ownerSeries(req.user._id, req.params.seriesId); const set = {}; if (Object.hasOwn(req.body, "name") || Object.hasOwn(req.body, "title")) { const name = normalizeSeriesName(req.body.name || req.body.title); if (!name) throw new ApiError(400, "Series name is required"); const normalizedName = normalizeSeriesKey(name); const duplicate = await PublicationSeries.exists({ _id: { $ne: series._id }, creator: req.user._id, normalizedName, archivedAt: null }); if (duplicate) throw new ApiError(409, "You already have a Series with that name"); set.name = name; set.normalizedName = normalizedName; } if (Object.hasOwn(req.body, "description")) set.description = normalizeSeriesDescription(req.body.description); if (Object.hasOwn(req.body, "coverMedia")) set.coverMedia = req.body.coverMedia?.secureUrl ? req.body.coverMedia : undefined; if (Object.hasOwn(req.body, "isPinned")) set.isPinned = Boolean(req.body.isPinned); const updated = await PublicationSeries.findByIdAndUpdate(series._id, { $set: set }, { new: true, runValidators: true }); return sendResponse(res, 200, "Series updated", { series: serializeSeries(updated, []) }); });
export const deleteSeries = asyncHandler(async (req, res) => { const series = await ownerSeries(req.user._id, req.params.seriesId); await Publication.updateMany({ creator: req.user._id, series: series._id }, { $set: { series: null } }); series.archivedAt = new Date(); await series.save(); return sendResponse(res, 200, "Series deleted. Your Seens remain on your profile.", { id: String(series._id) }); });
export const addSeenToSeries = asyncHandler(async (req, res) => { const series = await ownerSeries(req.user._id, req.params.seriesId); const seen = await ownerSeen(req.user._id, req.params.seenId); if (seen.kind !== "SEEN") throw new ApiError(400, "Only Seens can be added to Series"); seen.series = series._id; await seen.save(); await seen.populate("series", "name"); return sendResponse(res, 200, "Seen moved to Series", { publication: serializePublication(seen, req.user), series: serializeSeries(series, [seen]) }); });
export const removeSeenFromSeries = asyncHandler(async (req, res) => { const series = await ownerSeries(req.user._id, req.params.seriesId); const seen = await ownerSeen(req.user._id, req.params.seenId); if (String(seen.series || "") !== String(series._id)) throw new ApiError(404, "Seen is not in this Series"); seen.series = null; await seen.save(); return sendResponse(res, 200, "Seen removed from Series", { publication: serializePublication(seen, req.user) }); });
export const createChapter = asyncHandler(async (req, res) => sendResponse(res, 201, "Chapter added", { chapter: await addChapter(req.user._id, req.params.id, req.body) }));
export const editChapter = asyncHandler(async (req, res) => sendResponse(res, 200, "Chapter updated", { chapter: await updateChapter(req.user._id, req.params.id, req.params.chapterId, req.body) }));
export const deleteChapter = asyncHandler(async (req, res) => {
  const publication = await Publication.findOne({ _id: req.params.id, creator: req.user._id }).select("kind").lean();
  if (publication?.kind === "EXPERIENCE" && await WorldEntitlement.exists({ publication: publication._id, status: "ACTIVE" }))
    throw new ApiError(409, "Purchased Experience chapters cannot be removed; add a new chapter or revise the existing content instead");
  return sendResponse(res, 200, "Chapter removed", { publication: await removeChapter(req.user._id, req.params.id, req.params.chapterId, req.body) });
});
export const reorder = asyncHandler(async (req, res) => sendResponse(res, 200, "Chapters reordered", { publication: await reorderChapters(req.user._id, req.params.id, req.body) }));
async function enforcePremiumExperienceCapacity(creatorId, publicationId) {
  const publication = await Publication.findOne({ _id: publicationId, creator: creatorId }).select("kind pricing").lean();
  if (publication?.kind !== "EXPERIENCE" || publication.pricing?.mode !== "ONE_TIME") return;
  const active = await Publication.countDocuments({ _id: { $ne: publication._id }, creator: creatorId, kind: "EXPERIENCE", "pricing.mode": "ONE_TIME", status: { $in: ["PENDING_REVIEW", "CHANGES_REQUESTED", "PUBLISHED"] } });
  if (active >= 3) throw new ApiError(409, "A creator may have at most three active Premium Experiences");
}
export const submit = asyncHandler(async (req, res) => { await enforcePremiumExperienceCapacity(req.user._id, req.params.id); const publication = await submitPublication(req.user._id, req.params.id, req.body); return sendResponse(res, 200, publication.kind === "EXPERIENCE" ? "Experience published" : "Publication submitted", { publication: serializePublication(publication, req.user) }); });
export const resubmit = asyncHandler(async (req, res) => { await enforcePremiumExperienceCapacity(req.user._id, req.params.id); const publication = await resubmitPublication(req.user._id, req.params.id, req.body); return sendResponse(res, 200, publication.kind === "EXPERIENCE" ? "Experience updated and published" : "Publication resubmitted", { publication: serializePublication(publication, req.user) }); });
export const startRevision = asyncHandler(async (req, res) => sendResponse(res, 200, "Published revision started", { publication: serializePublication(await startPublishedRevision(req.user._id, req.params.id, req.body), req.user) }));
export const cancelRevision = asyncHandler(async (req, res) => sendResponse(res, 200, "Published revision canceled", { publication: serializePublication(await cancelPublishedRevision(req.user._id, req.params.id, req.body), req.user) }));
export const archive = asyncHandler(async (req, res) => sendResponse(res, 200, "Publication archived", { publication: serializePublication(await archivePublication(req.user._id, req.params.id, req.body), req.user) }));
export const pinSeen = asyncHandler(async (req, res) => sendResponse(res, 200, req.body.pinned ? "Seen pinned" : "Seen unpinned", { publication: serializePublication(await toggleSeenPinned(req.user._id, req.params.id, req.body), req.user) }));
export const setCommentsEnabled = asyncHandler(async (req, res) => {
  const publication = await Publication.findOneAndUpdate({ _id: req.params.id, creator: req.user._id }, { $set: { commentsEnabled: req.body.enabled !== false } }, { new: true });
  if (!publication) throw new ApiError(404, "Publication not found");
  return sendResponse(res, 200, publication.commentsEnabled ? "Comments enabled" : "Comments disabled", { commentsEnabled: publication.commentsEnabled });
});
export const removeSeen = asyncHandler(async (req, res) => { await deleteSeenPublication(req.user._id, req.params.id, req.body); return sendResponse(res, 200, "Seen deleted", { id: req.params.id }); });
export const removePlanet = asyncHandler(async (req, res) => { await deletePlanet(req.user._id, req.params.id, req.body); return sendResponse(res, 200, "Planet deleted", { id: req.params.id }); });
export const getSeenInsights = asyncHandler(async (req, res) => {
  const publication = await Publication.findOne({ _id: req.params.id, creator: req.user._id });
  if (!publication) throw new ApiError(404, "Publication not found");
  const sevenDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
  sevenDaysAgo.setHours(0, 0, 0, 0);
  const [engagementRows, uniqueViewers, analyticsRows, dailyViews, revenueRows, ownerCount, starsPerUsd] = await Promise.all([
    SeenEngagement.aggregate([{ $match: { publication: publication._id } }, { $group: { _id: "$type", count: { $sum: 1 } } }]),
    SeenEngagement.distinct("user", { publication: publication._id }),
    AnalyticsEvent.aggregate([
      { $match: { entityId: String(publication._id), eventType: { $in: ["CONTENT_IMPRESSION", "CONTENT_OPENED", "CONTENT_VIEW", "SEEN_VIEW"] } } },
      { $group: { _id: "$eventType", count: { $sum: 1 }, users: { $addToSet: "$userId" } } },
    ]),
    AnalyticsEvent.aggregate([{ $match: { entityId: String(publication._id), eventType: { $in: ["CONTENT_OPENED", "CONTENT_VIEW", "SEEN_VIEW"] }, createdAt: { $gte: sevenDaysAgo } } }, { $group: { _id: { $dateToString: { date: "$createdAt", format: "%Y-%m-%d" } }, value: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    StarsLedgerEntry.aggregate([{ $match: { accountUser: req.user._id, publication: publication._id, entryType: { $in: ["WORLD_CREATOR_EARNING", "CREATOR_EARNING_REVERSAL"] } } }, { $group: { _id: null, stars: { $sum: "$signedAmount" } } }]),
    WorldEntitlement.countDocuments({ publication: publication._id, status: "ACTIVE" }),
    getStarExchangeRate(),
  ]);
  const engagement = Object.fromEntries(engagementRows.map((row) => [row._id, row.count]));
  const analytics = Object.fromEntries(analyticsRows.map((row) => [row._id, { count: row.count, uniqueUsers: row.users.length }]));
  return sendResponse(res, 200, "Seen insights fetched", {
    insights: {
      seenId: String(publication._id),
      views: (engagement.WALKED || 0) + (engagement.REACTION || 0) + (engagement.COMMENT || 0) + (engagement.SHARE || 0) + (engagement.SAVE || 0),
      uniqueViewers: uniqueViewers.length,
      saves: engagement.SAVE || 0,
      shares: engagement.SHARE || 0,
      comments: engagement.COMMENT || 0,
      reactions: engagement.REACTION || 0,
      walked: engagement.WALKED || 0,
      impressions: analytics.CONTENT_IMPRESSION?.count || 0,
      opens: (analytics.CONTENT_OPENED?.count || 0) + (analytics.CONTENT_VIEW?.count || 0) + (analytics.SEEN_VIEW?.count || 0),
      uniqueImpressionViewers: analytics.CONTENT_IMPRESSION?.uniqueUsers || 0,
      dailyViews,
      ownerCount,
      revenueStars: Number(revenueRows[0]?.stars || 0),
      revenueUsd: Number(revenueRows[0]?.stars || 0) / starsPerUsd,
      priceStars: Number(publication.pricing?.starsAmount || 0),
    },
  });
});
export const uploadMedia = asyncHandler(async (req, res) => { if (!req.file) throw new ApiError(400, "Media file is required"); const publication = await Publication.findOne({ _id: req.params.id, creator: req.user._id, status: { $in: ["DRAFT", "CHANGES_REQUESTED"] } }); if (!publication) throw new ApiError(404, "Editable publication not found"); const purpose = String(req.body.purpose || "BLOCK").toUpperCase(); const mediaType = purpose === "COVER" ? (String(req.file.mimetype || "").startsWith("video/") ? "VIDEO" : "IMAGE") : req.body.mediaType; const chapterId = purpose === "BLOCK" ? req.body.chapterId : "root"; const blockId = purpose === "BLOCK" ? req.body.blockId : purpose.toLowerCase(); if (!chapterId || !blockId) throw new ApiError(400, "chapterId and blockId are required for block media"); const uploaded = await uploadPublicationFile({ file: req.file, creatorId: req.user._id, publicationId: publication._id, chapterId, blockId, mediaType }); const duration = Number(uploaded.duration); const rejectUploaded = async (message) => { await deletePublicationFile(uploaded).catch(() => {}); throw new ApiError(400, message); }; if (purpose === "BLOCK" && publication.kind === "EXPERIENCE" && mediaType === "VIDEO" && duration > 30.1) await rejectUploaded("Experience preview videos must be 30 seconds or shorter"); if (purpose === "COVER" && mediaType === "VIDEO" && publication.kind === "SEEN" && duration > 30) await rejectUploaded("Seen videos must be 30 seconds or shorter"); if (purpose === "COVER" && mediaType === "VIDEO" && publication.kind !== "SEEN" && (duration < 15 || duration > 30)) await rejectUploaded("Planet preview video must be 15 to 30 seconds"); if (!["COVER", "INTRO"].includes(purpose)) return sendResponse(res, 201, "Publication media uploaded", uploaded); const statusVersion = Number(req.body.statusVersion); if (!Number.isSafeInteger(statusVersion)) throw new ApiError(400, "statusVersion is required"); const trusted = await verifyPublicationAsset({ assetId: uploaded.assetId, creatorId: req.user._id, publicationId: publication._id, chapterId, blockId, mediaType }); const field = purpose === "COVER" ? "coverMedia" : "introMedia"; const updated = await Publication.findOneAndUpdate({ _id: publication._id, creator: req.user._id, status: { $in: ["DRAFT", "CHANGES_REQUESTED"] } }, { $set: { [field]: trusted }, $inc: { statusVersion: 1, draftVersion: 1 } }, { new: true }); if (!updated) { await deletePublicationFile(uploaded).catch(() => {}); throw new ApiError(409, "Publication is no longer editable"); } return sendResponse(res, 201, `${purpose.toLowerCase()} media attached`, { assetId: uploaded.assetId, publication: { id: updated._id, statusVersion: updated.statusVersion, draftVersion: updated.draftVersion, [field]: trusted } }); });
export const removeMedia = asyncHandler(async (req, res) => {
  const purpose = String(req.params.purpose || "").toUpperCase();
  if (!["COVER", "INTRO"].includes(purpose)) throw new ApiError(400, "Unsupported publication media purpose");
  const field = purpose === "COVER" ? "coverMedia" : "introMedia";
  const statusVersion = Number(req.body.statusVersion);
  if (!Number.isSafeInteger(statusVersion)) throw new ApiError(400, "statusVersion is required");
  const publication = await Publication.findOne({ _id: req.params.id, creator: req.user._id, status: { $in: ["DRAFT", "CHANGES_REQUESTED"] } });
  if (!publication) throw new ApiError(404, "Editable publication not found");
  const media = publication[field];
  const updated = await Publication.findOneAndUpdate({ _id: publication._id, creator: req.user._id, status: publication.status, statusVersion }, { $unset: { [field]: 1 }, $inc: { statusVersion: 1, draftVersion: 1 } }, { new: true });
  if (!updated) throw new ApiError(409, "Publication changed while removing media");
  await deletePublicationFile(media).catch(() => {});
  return sendResponse(res, 200, `${purpose.toLowerCase()} media removed`, { publication: { id: updated._id, statusVersion: updated.statusVersion, draftVersion: updated.draftVersion } });
});
export const listPublishedSeens = asyncHandler(async (req, res) => {
  const paging = page(req);
  const filter = { kind: "SEEN", status: { $in: ["PUBLISHED", "CHANGES_REQUESTED"] }, publishedSnapshot: { $exists: true } };
  let candidateCreatorIds = [];
  if (req.query.creator) {
    candidateCreatorIds = [req.query.creator];
    filter.creator = req.query.creator;
  } else if (req.query.tab === "friends" && req.user?._id) {
    const following = await ProfileRelationship.find({ actor: req.user._id, type: "FOLLOW" }).select("target").lean();
    candidateCreatorIds = following.map((item) => item.target);
    filter.creator = { $in: candidateCreatorIds };
  } else if (req.query.tab === "friends") {
    filter.creator = { $in: [] };
  }
  Object.assign(filter, await seenVisibilityFilter(req.user || null, candidateCreatorIds));
  if (req.user?._id) {
    const [blocks, preferences] = await Promise.all([
      UserBlock.find({ $or: [{ blocker: req.user._id }, { blocked: req.user._id }] }).select("blocker blocked").lean(),
      PublicationPreference.find({ user: req.user._id, type: { $in: ["HIDDEN_SEEN", "MUTED_CREATOR"] } }).select("publication creator type").lean(),
    ]);
    const blockedCreatorIds = blocks.map((block) => String(block.blocker) === String(req.user._id) ? block.blocked : block.blocker);
    const mutedCreatorIds = preferences.filter((item) => item.type === "MUTED_CREATOR" && item.creator).map((item) => item.creator);
    const hiddenPublicationIds = preferences.filter((item) => item.type === "HIDDEN_SEEN" && item.publication).map((item) => item.publication);
    const excludedCreatorIds = [...blockedCreatorIds, ...mutedCreatorIds];
    if (excludedCreatorIds.length) {
      filter.creator = filter.creator && "$in" in filter.creator
        ? { ...filter.creator, $nin: excludedCreatorIds }
        : { $nin: excludedCreatorIds };
    }
    if (hiddenPublicationIds.length) filter._id = { $nin: hiddenPublicationIds };
  }
  const items = await Publication.find(filter).sort({ publishedAt: -1 }).skip((paging.page - 1) * paging.limit).limit(paging.limit).populate("creator", "name username avatar isVerified activeStatus").populate("series", "name").lean();
  await attachEntityMetadata(items, req.user || null);
  const publicationIds = items.map((item) => item._id);
  const creatorIds = [...new Set(items.map((item) => String(item.creator?._id || item.creator)).filter(Boolean))];
  const [engagementRows, reactionRows, viewerRows, profileRows, commentRows] = await Promise.all([
    publicationIds.length ? SeenEngagement.aggregate([{ $match: { publication: { $in: publicationIds } } }, { $group: { _id: { publication: "$publication", type: "$type" }, count: { $sum: 1 } } }]) : [],
    publicationIds.length ? SeenEngagement.aggregate([{ $match: { publication: { $in: publicationIds }, type: "REACTION" } }, { $group: { _id: { publication: "$publication", reaction: { $ifNull: ["$reaction", "LIKE"] } }, count: { $sum: 1 } } }]) : [],
    req.user?._id && publicationIds.length ? SeenEngagement.find({ publication: { $in: publicationIds }, user: req.user._id, type: { $in: ["REACTION", "SHARE", "SAVE"] } }).lean() : [],
    creatorIds.length ? CreatorProfile.find({ user: { $in: creatorIds } }).select("user city country orbitStatus").lean() : [],
    publicationIds.length ? SeenEngagement.find({ publication: { $in: publicationIds }, type: "COMMENT" }).sort({ createdAt: -1 }).limit(100).populate("user", "name username avatar").lean() : [],
  ]);
  const profileByUser = new Map(profileRows.map((item) => [String(item.user), item]));
  const engagementByPublication = new Map();
  for (const row of engagementRows) {
    const key = String(row._id.publication);
    const current = engagementByPublication.get(key) || {};
    current[row._id.type] = row.count;
    engagementByPublication.set(key, current);
  }
  const reactionsByPublication = new Map();
  for (const row of sortSeenReactionRows(reactionRows)) {
    const key = String(row._id.publication);
    const current = reactionsByPublication.get(key) || { reactionBreakdown: {}, topReactions: [] };
    current.reactionBreakdown[row._id.reaction] = row.count;
    current.topReactions.push(row._id.reaction);
    reactionsByPublication.set(key, current);
  }
  const viewerByPublication = new Map();
  for (const row of viewerRows) {
    const key = String(row.publication);
    const current = viewerByPublication.get(key) || {};
    if (row.type === "REACTION") current.viewerReaction = row.reaction || null;
    if (row.type === "SHARE") current.viewerShared = true;
    if (row.type === "SAVE") current.viewerSaved = true;
    viewerByPublication.set(key, current);
  }
  const previewCommentByPublication = new Map();
  for (const row of commentRows) {
    const key = String(row.publication);
    if (previewCommentByPublication.has(key)) continue;
    previewCommentByPublication.set(key, {
      id: row._id,
      text: row.text,
      createdAt: row.createdAt,
      author: { id: row.user?._id, name: row.user?.name, username: row.user?.username, avatar: row.user?.avatar || "" },
    });
  }
  const itemsWithEngagement = items.map((item) => {
    const serialized = serializePublication(item, req.user || null, { audienceAllowed: true });
    if (!serialized) return null;
    const counts = engagementByPublication.get(String(item._id)) || {};
    const reactionSummary = reactionsByPublication.get(String(item._id)) || { reactionBreakdown: {}, topReactions: [] };
    const viewer = viewerByPublication.get(String(item._id)) || {};
    const profile = profileByUser.get(String(item.creator?._id || item.creator)) || {};
    return {
      ...serialized,
      creator: {
        ...serialized.creator,
        verified: Boolean(item.creator?.isVerified),
        status: item.creator?.activeStatus?.isActive ? item.creator.activeStatus.label : "",
        location: [profile.city, profile.country].filter(Boolean).join(", "),
      },
      engagement: {
        reactionCount: counts.REACTION || 0,
        reactionBreakdown: reactionSummary.reactionBreakdown,
        topReactions: reactionSummary.topReactions.slice(0, 3),
        commentCount: counts.COMMENT || 0,
        shareCount: counts.SHARE || 0,
        saveCount: counts.SAVE || 0,
        viewCount: (counts.WALKED || 0) + (counts.REACTION || 0) + (counts.COMMENT || 0) + (counts.SHARE || 0) + (counts.SAVE || 0),
        viewerReaction: viewer.viewerReaction || null,
        viewerShared: Boolean(viewer.viewerShared),
        viewerSaved: Boolean(viewer.viewerSaved),
      },
      previewComment: previewCommentByPublication.get(String(item._id)) || null,
    };
  }).filter(Boolean);
  return sendResponse(res, 200, "Published Seens fetched", { items: itemsWithEngagement, pagination: { ...paging, hasMore: items.length === paging.limit } });
});
export const getPublishedPublication = asyncHandler(async (req, res) => {
  const publication = await Publication.findById(req.params.id).select("+shareToken").populate("creator", "name username avatar isVerified").populate("series", "name").lean();
  if (publication) await attachEntityMetadata(publication, req.user || null);
  const entitlement = publication ? await publicationEntitlement(publication, req.user || null) : null;
  const audienceAllowed = publication ? await canAccessPublicationAudience(publication, req.user || null, { shareToken: req.query.access || req.query.token }) : false;
  const serialized = publication && serializePublication(publication, req.user || null, { audienceAllowed, entitlement });
  if (!serialized) throw new ApiError(404, "Publication not found");

  if (publication.kind === "SEEN") {
    const creatorId = publication.creator?._id || publication.creator;
    const sequenceFilter = {
      _id: { $ne: publication._id },
      creator: creatorId,
      kind: "SEEN",
      status: { $in: ["PUBLISHED", "CHANGES_REQUESTED"] },
      publishedSnapshot: { $exists: true },
      $or: [{ visibility: "PUBLIC" }, { visibility: { $exists: false } }, { visibility: null }, { visibility: "" }],
    };
    let nextPublication = await Publication.findOne({
      ...sequenceFilter,
      publishedAt: { $lt: publication.publishedAt || publication.createdAt },
    }).sort({ publishedAt: -1 }).populate("creator", "name username avatar isVerified").lean();
    nextPublication ||= await Publication.findOne(sequenceFilter).sort({ publishedAt: -1 }).populate("creator", "name username avatar isVerified").lean();
    serialized.nextSeen = nextPublication
      ? serializePublication(nextPublication, req.user || null, { audienceAllowed: true })
      : null;
  }

  return sendResponse(res, 200, "Publication fetched", { publication: serialized });
});
