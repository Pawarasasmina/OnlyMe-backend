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
