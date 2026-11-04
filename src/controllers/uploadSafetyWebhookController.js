import crypto from "node:crypto";
import { env } from "../config/env.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { createUploadSafetyFlag } from "../services/uploadSafetyFlagService.js";
function safeEqual(left, right) { const a = Buffer.from(String(left || "")); const b = Buffer.from(String(right || "")); return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b); }
export const receiveUploadSafetyFlag = asyncHandler(async (req, res) => { if (!env.uploadScanWebhookSecret || !safeEqual(req.get("X-Scanner-Secret"), env.uploadScanWebhookSecret)) throw new ApiError(401, "Invalid scanner credentials"); const { author, category, confidence, provider, scope, snapshot, target } = req.body || {}; if (!author || !scope || !snapshot) throw new ApiError(400, "Scanner flag requires author, scope, and snapshot"); const report = await createUploadSafetyFlag({ author, category, confidence, provider, scope, snapshot, target }); return sendResponse(res, 202, "Upload safety flag queued", { reportId: report._id, priority: report.priority, dueAt: report.dueAt }); });
