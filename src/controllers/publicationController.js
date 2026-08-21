import Chapter from "../models/Chapter.js";
import CreatorProfile from "../models/CreatorProfile.js";
import PremiumMembership from "../models/PremiumMembership.js";
import Publication from "../models/Publication.js";
import PublicationPreference from "../models/PublicationPreference.js";
import ProfileRelationship from "../models/ProfileRelationship.js";
import SeenEngagement from "../models/SeenEngagement.js";
import UserBlock from "../models/UserBlock.js";
import { serializePublication } from "../services/publicationAccessService.js";
import { addChapter, archivePublication, cancelPublishedRevision, createPublicationDraft, deletePlanet, ownerPublication, removeChapter, reorderChapters, resubmitPublication, startPublishedRevision, submitPublication, updateChapter, updatePublicationDraft } from "../services/publicationService.js";
import { uploadPublicationFile, verifyPublicationAsset } from "../services/publicationMediaStorageService.js";
import { publicationEntitlement } from "../services/publicationEntitlementService.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

const page = (req) => ({ page: Math.max(1, Number(req.query.page) || 1), limit: Math.min(50, Math.max(1, Number(req.query.limit) || 20)) });
const ownerView = (publication, chapters, user) => { const item = publication.toObject ? publication.toObject() : publication; if (!item.submittedSnapshot || ["DRAFT", "CHANGES_REQUESTED"].includes(item.status)) item.submittedSnapshot = { metadata: item, chapters, version: item.draftVersion, frozenAt: new Date() }; return serializePublication(item, user); };
export const listMine = asyncHandler(async (req, res) => { const paging = page(req); const filter = { creator: req.user._id }; if (req.query.kind) filter.kind = req.query.kind.includes(",") ? { $in: req.query.kind.split(",") } : req.query.kind; if (req.query.status) filter.status = req.query.status; const [items, total] = await Promise.all([Publication.find(filter).sort({ updatedAt: -1 }).skip((paging.page - 1) * paging.limit).limit(paging.limit).lean(), Publication.countDocuments(filter)]); const publicationIds = items.map((item) => item._id); const [counts, residentRows] = await Promise.all([Chapter.aggregate([{ $match: { publication: { $in: publicationIds } } }, { $group: { _id: "$publication", count: { $sum: 1 }, previewCount: { $sum: { $cond: ["$isPreview", 1, 0] } } } }]), PremiumMembership.aggregate([{ $match: { creator: req.user._id, premiumPublication: { $in: publicationIds }, status: { $in: ["ACTIVE", "CANCEL_AT_PERIOD_END"] }, currentPeriodEnd: { $gt: new Date() } } }, { $group: { _id: "$premiumPublication", residentCount: { $sum: 1 }, monthlyStars: { $sum: "$starsPerPeriod" } } }])]); const chapterCounts = new Map(counts.map((entry) => [String(entry._id), entry])); const residentCounts = new Map(residentRows.map((entry) => [String(entry._id), entry])); return sendResponse(res, 200, "Publications fetched", { items: items.map((item) => { const residents = residentCounts.get(String(item._id)); return { id: item._id, kind: item.kind, title: item.title, summary: item.summary, coverMedia: item.coverMedia ? { mediaType: item.coverMedia.mediaType, format: item.coverMedia.format, width: item.coverMedia.width, height: item.coverMedia.height, secureUrl: item.coverMedia.secureUrl } : null, chapterCount: chapterCounts.get(String(item._id))?.count || 0, previewCount: chapterCounts.get(String(item._id))?.previewCount || 0, residentCount: residents?.residentCount || 0, monthlyStars: residents?.monthlyStars || 0, pricing: item.pricing, planet: item.planet, status: item.status, statusVersion: item.statusVersion, draftVersion: item.draftVersion, submittedAt: item.submittedAt, publishedAt: item.publishedAt, archivedAt: item.archivedAt, createdAt: item.createdAt, updatedAt: item.updatedAt }; }), pagination: { ...paging, total, pages: Math.max(1, Math.ceil(total / paging.limit)) } }); });
export const getMine = asyncHandler(async (req, res) => { const { publication, chapters } = await ownerPublication(req.user._id, req.params.id); return sendResponse(res, 200, "Publication fetched", { publication: ownerView(publication, chapters, req.user) }); });
export const createDraft = asyncHandler(async (req, res) => sendResponse(res, 201, "Publication draft created", { publication: ownerView(await createPublicationDraft(req.user._id, req.body), [], req.user) }));
export const updateDraft = asyncHandler(async (req, res) => { const publication = await updatePublicationDraft(req.user._id, req.params.id, req.body); const chapters = await Chapter.find({ publication: publication._id }).sort({ order: 1 }).lean(); return sendResponse(res, 200, "Publication updated", { publication: ownerView(publication, chapters, req.user) }); });
export const createChapter = asyncHandler(async (req, res) => sendResponse(res, 201, "Chapter added", { chapter: await addChapter(req.user._id, req.params.id, req.body) }));
export const editChapter = asyncHandler(async (req, res) => sendResponse(res, 200, "Chapter updated", { chapter: await updateChapter(req.user._id, req.params.id, req.params.chapterId, req.body) }));
export const deleteChapter = asyncHandler(async (req, res) => sendResponse(res, 200, "Chapter removed", { publication: await removeChapter(req.user._id, req.params.id, req.params.chapterId, req.body) }));
export const reorder = asyncHandler(async (req, res) => sendResponse(res, 200, "Chapters reordered", { publication: await reorderChapters(req.user._id, req.params.id, req.body) }));
export const submit = asyncHandler(async (req, res) => sendResponse(res, 200, "Publication submitted", { publication: serializePublication(await submitPublication(req.user._id, req.params.id, req.body), req.user) }));
export const resubmit = asyncHandler(async (req, res) => sendResponse(res, 200, "Publication resubmitted", { publication: serializePublication(await resubmitPublication(req.user._id, req.params.id, req.body), req.user) }));
export const startRevision = asyncHandler(async (req, res) => sendResponse(res, 200, "Published revision started", { publication: serializePublication(await startPublishedRevision(req.user._id, req.params.id, req.body), req.user) }));
export const cancelRevision = asyncHandler(async (req, res) => sendResponse(res, 200, "Published revision canceled", { publication: serializePublication(await cancelPublishedRevision(req.user._id, req.params.id, req.body), req.user) }));
export const archive = asyncHandler(async (req, res) => sendResponse(res, 200, "Publication archived", { publication: serializePublication(await archivePublication(req.user._id, req.params.id, req.body), req.user) }));
export const removePlanet = asyncHandler(async (req, res) => { await deletePlanet(req.user._id, req.params.id, req.body); return sendResponse(res, 200, "Planet deleted", { id: req.params.id }); });
export const uploadMedia = asyncHandler(async (req, res) => { if (!req.file) throw new ApiError(400, "Media file is required"); const publication = await Publication.findOne({ _id: req.params.id, creator: req.user._id, status: { $in: ["DRAFT", "CHANGES_REQUESTED"] } }); if (!publication) throw new ApiError(404, "Editable publication not found"); const purpose = String(req.body.purpose || "BLOCK").toUpperCase(); const mediaType = purpose === "COVER" ? (String(req.file.mimetype || "").startsWith("video/") ? "VIDEO" : "IMAGE") : req.body.mediaType; const chapterId = purpose === "BLOCK" ? req.body.chapterId : "root"; const blockId = purpose === "BLOCK" ? req.body.blockId : purpose.toLowerCase(); if (!chapterId || !blockId) throw new ApiError(400, "chapterId and blockId are required for block media"); const uploaded = await uploadPublicationFile({ file: req.file, creatorId: req.user._id, publicationId: publication._id, chapterId, blockId, mediaType }); const duration = Number(uploaded.duration); if (purpose === "COVER" && mediaType === "VIDEO" && publication.kind === "SEEN" && duration > 30) throw new ApiError(400, "Seen videos must be 30 seconds or shorter"); if (purpose === "COVER" && mediaType === "VIDEO" && publication.kind !== "SEEN" && (duration < 15 || duration > 30)) throw new ApiError(400, "Planet preview video must be 15 to 30 seconds"); if (!["COVER", "INTRO"].includes(purpose)) return sendResponse(res, 201, "Publication media uploaded", uploaded); const statusVersion = Number(req.body.statusVersion); if (!Number.isSafeInteger(statusVersion)) throw new ApiError(400, "statusVersion is required"); const trusted = await verifyPublicationAsset({ assetId: uploaded.assetId, creatorId: req.user._id, publicationId: publication._id, chapterId, blockId, mediaType }); const field = purpose === "COVER" ? "coverMedia" : "introMedia"; const updated = await Publication.findOneAndUpdate({ _id: publication._id, creator: req.user._id, status: publication.status, statusVersion }, { $set: { [field]: trusted }, $inc: { statusVersion: 1, draftVersion: 1 } }, { new: true }); if (!updated) throw new ApiError(409, "Publication changed while attaching media"); return sendResponse(res, 201, `${purpose.toLowerCase()} media attached`, { assetId: uploaded.assetId, publication: { id: updated._id, statusVersion: updated.statusVersion, draftVersion: updated.draftVersion } }); });
export const listPublishedSeens = asyncHandler(async (req, res) => {
  const paging = page(req);
  const filter = { kind: "SEEN", status: "PUBLISHED" };
  if (req.query.tab === "friends" && req.user?._id) {
    const following = await ProfileRelationship.find({ actor: req.user._id, type: "FOLLOW" }).select("target").lean();
    filter.creator = { $in: following.map((item) => item.target) };
  }
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
  const items = await Publication.find(filter).sort({ publishedAt: -1 }).skip((paging.page - 1) * paging.limit).limit(paging.limit).populate("creator", "name username avatar isVerified activeStatus").lean();
  const publicationIds = items.map((item) => item._id);
  const creatorIds = [...new Set(items.map((item) => String(item.creator?._id || item.creator)).filter(Boolean))];
  const [engagementRows, reactionRows, viewerRows, profileRows, commentRows] = await Promise.all([
    publicationIds.length ? SeenEngagement.aggregate([{ $match: { publication: { $in: publicationIds } } }, { $group: { _id: { publication: "$publication", type: "$type" }, count: { $sum: 1 } } }]) : [],
    publicationIds.length ? SeenEngagement.aggregate([{ $match: { publication: { $in: publicationIds }, type: "REACTION" } }, { $group: { _id: { publication: "$publication", reaction: { $ifNull: ["$reaction", "LIKE"] } }, count: { $sum: 1 } } }, { $sort: { count: -1, "_id.reaction": 1 } }]) : [],
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
  for (const row of reactionRows) {
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
    const serialized = serializePublication(item, req.user || null);
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
export const getPublishedPublication = asyncHandler(async (req, res) => { const publication = await Publication.findById(req.params.id).populate("creator", "name username avatar isVerified").lean(); const entitlement = publication ? await publicationEntitlement(publication, req.user || null) : null; const serialized = publication && serializePublication(publication, req.user || null, { entitlement }); if (!serialized) throw new ApiError(404, "Publication not found"); return sendResponse(res, 200, "Publication fetched", { publication: serialized }); });
