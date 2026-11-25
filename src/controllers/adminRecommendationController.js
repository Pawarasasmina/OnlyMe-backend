import AdminAuditEvent from "../models/AdminAuditEvent.js";
import mongoose from "mongoose";
import User from "../models/User.js";
import Publication from "../models/Publication.js";
import FeedPost from "../models/FeedPost.js";
import WallPost from "../models/WallPost.js";
import Story from "../models/Story.js";
import Content from "../models/Content.js";
import RecommendationExclusion from "../models/RecommendationExclusion.js";
import RecommendationConfig from "../models/RecommendationConfig.js";
import RecommendationBatch from "../models/RecommendationBatch.js";
import AnalyticsEvent from "../models/AnalyticsEvent.js";
import { clearRecommendationConfigCache, DEFAULT_RECOMMENDATION_CONFIG, getActiveRecommendationConfig, validateRecommendationConfig } from "../services/recommendationService.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

const serialize = (row) => row && ({ id: String(row._id), version: row.version, status: row.status, config: row.config, note: row.note || "", createdAt: row.createdAt, activatedAt: row.activatedAt, createdBy: row.createdBy, activatedBy: row.activatedBy });

export const getRecommendationSettings = asyncHandler(async (_req, res) => {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [active, drafts, history, batches] = await Promise.all([
    RecommendationConfig.findOne({ status: "ACTIVE" }).sort({ version: -1 }).populate("activatedBy", "name username").lean(),
    RecommendationConfig.find({ status: "DRAFT" }).sort({ version: -1 }).limit(5).populate("createdBy", "name username").lean(),
    RecommendationConfig.find({ status: { $in: ["ACTIVE", "ARCHIVED"] } }).sort({ version: -1 }).limit(20).populate("activatedBy", "name username").lean(),
    RecommendationBatch.find({ createdAt: { $gte: since } }).select("_id configVersion itemIds surface").limit(10000).lean(),
  ]);
  const batchIds = batches.map((row) => String(row._id));
  const eventRows = batchIds.length ? await AnalyticsEvent.aggregate([
    { $match: { createdAt: { $gte: since }, "metadata.batchId": { $in: batchIds } } },
    { $group: { _id: { batchId: "$metadata.batchId", eventType: "$eventType" }, count: { $sum: 1 }, avgCompletion: { $avg: "$metadata.completion" }, avgWatchMs: { $avg: "$metadata.watchMs" } } },
  ]) : [];
  const versionByBatch = new Map(batches.map((row) => [String(row._id), row.configVersion]));
  const metricsByVersion = {};
  for (const batch of batches) {
    const target = metricsByVersion[batch.configVersion] ||= { batches: 0, deliveredItems: 0, events: {}, averageCompletion: 0, averageWatchMs: 0, measuredEvents: 0 };
    target.batches += 1; target.deliveredItems += batch.itemIds.length;
  }
  for (const row of eventRows) {
    const version = versionByBatch.get(String(row._id.batchId));
    if (!version) continue;
    const target = metricsByVersion[version];
    target.events[row._id.eventType] = (target.events[row._id.eventType] || 0) + row.count;
    if (row.avgCompletion != null) target.averageCompletion += row.avgCompletion * row.count;
    if (row.avgWatchMs != null) target.averageWatchMs += row.avgWatchMs * row.count;
    target.measuredEvents += row.count;
  }
  for (const target of Object.values(metricsByVersion)) {
    target.averageCompletion = target.measuredEvents ? Number((target.averageCompletion / target.measuredEvents).toFixed(3)) : 0;
    target.averageWatchMs = target.measuredEvents ? Math.round(target.averageWatchMs / target.measuredEvents) : 0;
  }
  const effective = await getActiveRecommendationConfig({ fresh: true });
  return sendResponse(res, 200, "Recommendation settings fetched", { active: active ? { ...serialize(active), config: validateRecommendationConfig(active.config) } : { version: effective.version, status: "DEFAULT", config: DEFAULT_RECOMMENDATION_CONFIG }, drafts: drafts.map(serialize), history: history.map(serialize), metricsByVersion, metricsWindowDays: 30 });
});

export const createRecommendationDraft = asyncHandler(async (req, res) => {
  const config = validateRecommendationConfig(req.body.config);
  const latest = await RecommendationConfig.findOne().sort({ version: -1 }).select("version").lean();
  const row = await RecommendationConfig.create({ version: (latest?.version || 0) + 1, status: "DRAFT", config, note: String(req.body.note || "").trim().slice(0, 300), createdBy: req.user._id });
  return sendResponse(res, 201, "Recommendation draft created", { item: serialize(row) });
});

export const activateRecommendationConfig = asyncHandler(async (req, res) => {
  const draft = await RecommendationConfig.findOne({ _id: req.params.id, status: { $in: ["DRAFT", "ARCHIVED"] } });
  if (!draft) throw new ApiError(404, "Recommendation configuration not found");
  validateRecommendationConfig(draft.config);
  await RecommendationConfig.updateMany({ status: "ACTIVE" }, { $set: { status: "ARCHIVED" } });
  draft.status = "ACTIVE"; draft.activatedBy = req.user._id; draft.activatedAt = new Date();
  await draft.save(); clearRecommendationConfigCache();
  return sendResponse(res, 200, "Recommendation configuration activated", { item: serialize(draft) });
});

export const resetRecommendationConfig = asyncHandler(async (req, res) => {
  const latest = await RecommendationConfig.findOne().sort({ version: -1 }).select("version").lean();
  await RecommendationConfig.updateMany({ status: "ACTIVE" }, { $set: { status: "ARCHIVED" } });
  const row = await RecommendationConfig.create({ version: (latest?.version || 0) + 1, status: "ACTIVE", config: validateRecommendationConfig(DEFAULT_RECOMMENDATION_CONFIG), note: String(req.body.note || "Emergency reset to safe defaults").slice(0, 300), createdBy: req.user._id, activatedBy: req.user._id, activatedAt: new Date() });
  clearRecommendationConfigCache();
  return sendResponse(res, 201, "Recommendation settings reset to safe defaults", { item: serialize(row) });
});

const targetModels = { User, Publication, FeedPost, WallPost, Story, Content };
export const listRecommendationExclusions = asyncHandler(async (_req, res) => {
  const items = await RecommendationExclusion.find().sort({ createdAt: -1 }).limit(1000).lean();
  return sendResponse(res, 200, "Recommendation exclusions fetched", { items });
});
export const searchRecommendationTargets = asyncHandler(async (req, res) => {
  const Model = Object.hasOwn(targetModels, req.query.model) ? targetModels[req.query.model] : null;
  if (!Model) throw new ApiError(400, "Choose a supported target type");
  const term = String(req.query.search || "").trim().slice(0, 100);
  if (!term) return sendResponse(res, 200, "Recommendation targets fetched", { items: [] });
  const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const fields = req.query.model === "User" ? ["name", "username", "email"] : ["title", "text", "caption", "publishedSnapshot.metadata.title"];
  const match = { $or: [...fields.map(field => ({ [field]: regex })), ...(mongoose.isValidObjectId(term) ? [{ _id: term }] : [])] };
  const rows = await Model.find(match).select("name username title text caption status creator author publishedSnapshot.metadata.title").limit(20).lean();
  return sendResponse(res, 200, "Recommendation targets fetched", { items: rows.map(row => ({ id: String(row._id), label: row.name || row.title || row.publishedSnapshot?.metadata?.title || row.text?.slice(0, 100) || row.caption || String(row._id), username: row.username, status: row.status })) });
});
export const setRecommendationExclusion = asyncHandler(async (req, res) => {
  const { targetModel, targetId, excluded } = req.body;
  if (!Object.hasOwn(targetModels, targetModel) || !mongoose.isValidObjectId(targetId) || typeof excluded !== "boolean") throw new ApiError(400, "Choose a valid item or account and exclusion state");
  const target = await targetModels[targetModel].findById(targetId).lean();
  if (!target) throw new ApiError(404, "Item or account not found");
  const reason = String(req.body.reason || "").trim().slice(0, 500);
  if (reason.length < 3) throw new ApiError(400, "Enter a reason of at least 3 characters");
  const filter = { targetModel, targetId };
  if (excluded) await RecommendationExclusion.findOneAndUpdate(filter, { $set: { reason, label: String(target.name || target.title || target.text || target.caption || targetId).slice(0, 200), createdBy: req.user._id } }, { upsert: true, new: true, runValidators: true });
  else await RecommendationExclusion.deleteOne(filter);
  await AdminAuditEvent.create({ actor: req.user._id, actorRole: req.adminRole || "MAIN_ADMIN", action: excluded ? "RECOMMENDATION_EXCLUDED" : "RECOMMENDATION_RESTORED", targetType: targetModel, targetId: String(targetId), reason, after: { excluded } });
  return sendResponse(res, 200, excluded ? "Excluded from recommendations" : "Recommendation exclusion removed", { excluded });
});

export const previewRecommendations = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.query.userId)) throw new ApiError(400, "Choose a valid user");
  const user = await User.findById(req.query.userId);
  if (!user || !["fan", "creator"].includes(user.role)) throw new ApiError(404, "User account not found");
  const surface = String(req.query.surface || "SEEN").toUpperCase();
  const loaders = {
    SEEN: async () => (await import("./publicationController.js")).listPublishedSeens,
    WALL: async () => (await import("./postController.js")).listFeedPosts,
    STORIES: async () => (await import("./storyController.js")).listStories,
    DISCOVER: async () => (await import("./discoverController.js")).getDiscover,
  };
  if (!loaders[surface]) throw new ApiError(400, "Choose a valid recommendation surface");
  const handler = await loaders[surface]();
  // This flag is server-owned; public feed requests cannot turn it on.
  const previewReq = { user, query: { page: "1", limit: surface === "DISCOVER" ? "8" : "20", sort: "popular", view: surface === "DISCOVER" ? "slides" : undefined, refreshToken: "admin-preview" }, params: {}, headers: {}, recommendationPreview: true };
  const payload = await new Promise((resolve, reject) => {
    const previewRes = { req: previewReq, status() { return this; }, json(body) { resolve(body.data); return this; } };
    handler(previewReq, previewRes, reject);
  });
  const rows = payload.items || payload.groups || payload.recommendations || [];
  const items = rows.map((item, index) => ({ position: index + 1, id: String(item.id || item._id || item.user?.id || ""), title: item.title || item.text?.slice(0, 160) || item.creator?.name || item.user?.name || "Story", creator: item.creator || item.author || item.user, kind: item.kind || surface, recommendation: item.recommendation, storyIds: item.stories?.map(story => String(story.id || story._id)) }));
  return sendResponse(res, 200, "Recommendation preview fetched", { user: { id: String(user._id), name: user.name, username: user.username, status: user.status }, surface, items, recommendation: payload.recommendation || { configVersion: payload.pagination?.configVersion }, preview: true });
});
