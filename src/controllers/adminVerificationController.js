import mongoose from "mongoose";
import CreatorVerification from "../models/CreatorVerification.js";
import VerificationReviewHistory from "../models/VerificationReviewHistory.js";
import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { assertDocumentField } from "../validators/verificationValidator.js";
import { openVerificationDocument, setPrivateDocumentHeaders } from "../services/privateDocumentStorageService.js";
import { serializeCreatorVerification } from "./creatorVerificationController.js";
import { performVerificationDecision } from "../services/verificationDecisionService.js";

const clean = (value, max = 2000) => String(value || "").trim().slice(0, max);
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function adminView(verification) {
  return {
    ...serializeCreatorVerification(verification),
    adminInternalNote: verification.adminInternalNote,
    reviewedBy: verification.reviewedBy,
    legacyMigrated: verification.legacyMigrated,
    legacyMigratedAt: verification.legacyMigratedAt,
    stateSyncPending: verification.stateSyncPending,
    stateSyncError: verification.stateSyncError,
    creator: verification.creator,
  };
}
export const listCreatorVerifications = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
  const filter = {};
  if (["NOT_STARTED", "DRAFT", "PENDING_REVIEW", "CHANGES_REQUESTED", "APPROVED", "REJECTED"].includes(req.query.status)) filter.status = req.query.status;
  if (req.query.country) filter.country = new RegExp(`^${escapeRegex(req.query.country)}$`, "i");
  if (["national_id", "passport", "driver_license", "other"].includes(req.query.documentType)) filter.documentType = req.query.documentType;
  if (req.query.search) {
    const term = new RegExp(escapeRegex(req.query.search), "i");
    const creatorIds = await User.find({ role: "creator", $or: [{ username: term }, { email: term }] }).distinct("_id");
    filter.creator = { $in: creatorIds };
  }
  const [items, total] = await Promise.all([
    CreatorVerification.find(filter)
      .populate("creator", "name username email creatorApprovalStatus status avatar")
      .sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    CreatorVerification.countDocuments(filter),
  ]);
  return sendResponse(res, 200, "Creator verifications fetched", {
    items: items.map(adminView),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

export const getCreatorVerification = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid verification ID");
  const verification = await CreatorVerification.findById(req.params.id)
    .populate("creator", "name username email creatorApprovalStatus status avatar createdAt")
    .populate("reviewedBy", "name username email");
  if (!verification) throw new ApiError(404, "Creator verification not found");
  return sendResponse(res, 200, "Creator verification fetched", { verification: adminView(verification) });
});

export const streamAdminVerificationFile = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid verification ID");
  const documentType = assertDocumentField(req.params.documentType);
  const verification = await CreatorVerification.findById(req.params.id);
  const metadata = verification?.[documentType];
  if (!metadata) throw new ApiError(404, "Verification document not found");
  const stream = await openVerificationDocument(metadata.storageKey);
  setPrivateDocumentHeaders(res, metadata);
  stream.on("error", (error) => res.destroy(error));
  stream.pipe(res);
});

export const approveCreatorVerification = asyncHandler(async (req, res) => {
  if (req.body.manualReviewConfirmed !== true) throw new ApiError(400, "Manual review confirmation is required");
  const verification = await performVerificationDecision({
    id: req.params.id,
    targetStatus: "APPROVED",
    adminId: req.user._id,
    review: {
      adminInternalNote: clean(req.body.adminInternalNote),
      creatorVisibleMessage: clean(req.body.creatorVisibleMessage) || "Your creator verification was approved.",
      rejectionReason: "",
      changesRequestedReasons: [],
    },
  });
  return sendResponse(res, 200, "Creator verification approved", { verification: adminView(verification) });
});

export const requestCreatorVerificationChanges = asyncHandler(async (req, res) => {
  const creatorVisibleMessage = clean(req.body.creatorVisibleMessage);
  if (!creatorVisibleMessage) throw new ApiError(400, "Creator-visible message is required");
  const reasons = Array.isArray(req.body.reasons)
    ? req.body.reasons.map((value) => clean(value, 200)).filter(Boolean).slice(0, 20)
    : [];
  const verification = await performVerificationDecision({
    id: req.params.id,
    targetStatus: "CHANGES_REQUESTED",
    adminId: req.user._id,
    review: {
      adminInternalNote: clean(req.body.adminInternalNote),
      creatorVisibleMessage,
      rejectionReason: "",
      changesRequestedReasons: reasons,
    },
  });
  return sendResponse(res, 200, "Verification changes requested", { verification: adminView(verification) });
});

export const rejectCreatorVerification = asyncHandler(async (req, res) => {
  const rejectionReason = clean(req.body.rejectionReason, 1000);
  const creatorVisibleMessage = clean(req.body.creatorVisibleMessage);
  if (!rejectionReason || !creatorVisibleMessage) throw new ApiError(400, "Rejection reason and creator-visible message are required");
  const verification = await performVerificationDecision({
    id: req.params.id,
    targetStatus: "REJECTED",
    adminId: req.user._id,
    review: {
      adminInternalNote: clean(req.body.adminInternalNote),
      creatorVisibleMessage,
      rejectionReason,
      changesRequestedReasons: [],
    },
  });
  return sendResponse(res, 200, "Creator verification rejected", { verification: adminView(verification) });
});
export const getCreatorVerificationHistory = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid verification ID");
  const exists = await CreatorVerification.exists({ _id: req.params.id });
  if (!exists) throw new ApiError(404, "Creator verification not found");
  const history = await VerificationReviewHistory.find({ verification: req.params.id })
    .populate("admin", "name username email").sort({ createdAt: 1 }).lean();
  return sendResponse(res, 200, "Verification review history fetched", { history });
});

