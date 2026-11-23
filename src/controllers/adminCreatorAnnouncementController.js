import mongoose from "mongoose";
import CreatorAnnouncement from "../models/CreatorAnnouncement.js";
import CreatorAnnouncementRecipient from "../models/CreatorAnnouncementRecipient.js";
import CreatorProfile from "../models/CreatorProfile.js";
import AdminAuditEvent from "../models/AdminAuditEvent.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { effectiveAdminRole } from "../middleware/adminPermissionMiddleware.js";
import { audiencePreview, creatorAudienceFilter, processDueCreatorAnnouncements, snapshotRecipients } from "../services/creatorAnnouncementService.js";

const clean = (value, max) => String(value || "").trim().slice(0, max);
const serialize = (item) => ({ id: item._id, name: item.name, title: item.title, message: item.message, actionLabel: item.actionLabel, actionUrl: item.actionUrl, channels: item.channels, audience: item.audience, status: item.status, scheduledAt: item.scheduledAt, startedAt: item.startedAt, completedAt: item.completedAt, cancelledAt: item.cancelledAt, counts: item.counts, createdAt: item.createdAt, createdBy: item.createdBy && { id: item.createdBy._id, name: item.createdBy.name, username: item.createdBy.username } });

export const previewCreatorAnnouncementAudience = asyncHandler(async (req, res) => sendResponse(res, 200, "Creator audience preview fetched", await audiencePreview(req.body?.audience, { page: req.body?.page, limit: req.body?.limit })));

export const getCreatorAnnouncementOptions = asyncHandler(async (_req, res) => {
  const [countries, categories] = await Promise.all([CreatorProfile.distinct("country", { country: { $ne: "" } }), CreatorProfile.distinct("categories", { categories: { $ne: "" } })]);
  const singleCategories = await CreatorProfile.distinct("category", { category: { $ne: "" } });
  return sendResponse(res, 200, "Creator announcement filter options fetched", { countries: countries.filter(Boolean).sort(), categories: [...new Set([...categories, ...singleCategories].filter(Boolean))].sort(), languages: ["en", "ar", "ru", "uk", "es", "pt", "fr", "de"] });
});

export const createCreatorAnnouncement = asyncHandler(async (req, res) => {
  const name = clean(req.body.name, 120), title = clean(req.body.title, 160), message = clean(req.body.message, 2000);
  const channels = [...new Set((Array.isArray(req.body.channels) ? req.body.channels : []).map(String))].filter((v) => ["IN_APP", "EMAIL"].includes(v));
  if (!name || !title || !message) throw new ApiError(400, "Campaign name, title, and message are required");
  if (!channels.length) throw new ApiError(400, "Choose at least one delivery channel");
  const scheduledAt = req.body.scheduledAt ? new Date(req.body.scheduledAt) : new Date();
  if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() < Date.now() - 60000) throw new ApiError(400, "Choose a valid current or future delivery time");
  const actionLabel = clean(req.body.actionLabel, 80), actionUrl = clean(req.body.actionUrl, 500);
  if (Boolean(actionLabel) !== Boolean(actionUrl)) throw new ApiError(400, "Action label and URL must be provided together");
  if (actionUrl) { try { const parsed = new URL(actionUrl, "https://example.com"); if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("protocol"); } catch { throw new ApiError(400, "Action URL must be a valid web address or app path"); } }
  const { audience, filter } = await creatorAudienceFilter(req.body.audience);
  const campaign = await CreatorAnnouncement.create({ name, title, message, actionLabel, actionUrl, channels, audience, scheduledAt, createdBy: req.user._id });
  const count = await snapshotRecipients(campaign, filter);
  if (!count) { await CreatorAnnouncement.deleteOne({ _id: campaign._id }); throw new ApiError(400, "No creators match this audience"); }
  await AdminAuditEvent.create({ actor: req.user._id, actorRole: effectiveAdminRole(req.user), action: "CREATOR_ANNOUNCEMENT_SCHEDULED", targetType: "CREATOR_ANNOUNCEMENT", targetId: String(campaign._id), reason: `Scheduled creator announcement: ${name}`, after: { name, title, message, actionLabel, actionUrl, channels, audience, scheduledAt, recipientCount: count } });
  if (scheduledAt <= new Date()) void processDueCreatorAnnouncements(new Date(), req.app.get("io")).catch((error) => console.error("Immediate creator announcement delivery failed", error));
  return sendResponse(res, 201, "Creator announcement scheduled", { announcement: serialize(await CreatorAnnouncement.findById(campaign._id).populate("createdBy", "name username")) });
});

export const listCreatorAnnouncements = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1), limit = 20;
  const [items, total] = await Promise.all([CreatorAnnouncement.find().populate("createdBy", "name username").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), CreatorAnnouncement.countDocuments()]);
  return sendResponse(res, 200, "Creator announcements fetched", { announcements: items.map(serialize), pagination: { page, pages: Math.ceil(total / limit), total } });
});

export const getCreatorAnnouncement = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid announcement ID");
  const item = await CreatorAnnouncement.findById(req.params.id).populate("createdBy", "name username").lean();
  if (!item) throw new ApiError(404, "Creator announcement not found");
  const failures = await CreatorAnnouncementRecipient.find({ campaign: item._id, $or: [{ emailError: { $ne: "" } }, { emailSkippedReason: { $ne: "" } }] }).select("name email emailError emailSkippedReason").limit(50).lean();
  return sendResponse(res, 200, "Creator announcement fetched", { announcement: serialize(item), failures });
});

export const cancelCreatorAnnouncement = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid announcement ID");
  const reason = clean(req.body.reason, 500); if (!reason) throw new ApiError(400, "Cancellation reason is required");
  const item = await CreatorAnnouncement.findOneAndUpdate({ _id: req.params.id, status: "SCHEDULED" }, { $set: { status: "CANCELLED", cancelledAt: new Date(), cancelledBy: req.user._id } }, { new: true }).populate("createdBy", "name username");
  if (!item) throw new ApiError(409, "Only a scheduled announcement can be cancelled");
  await AdminAuditEvent.create({ actor: req.user._id, actorRole: effectiveAdminRole(req.user), action: "CREATOR_ANNOUNCEMENT_CANCELLED", targetType: "CREATOR_ANNOUNCEMENT", targetId: String(item._id), reason, before: { status: "SCHEDULED" }, after: { status: "CANCELLED" } });
  return sendResponse(res, 200, "Creator announcement cancelled", { announcement: serialize(item) });
});
