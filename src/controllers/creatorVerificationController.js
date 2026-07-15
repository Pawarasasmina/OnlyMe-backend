import CreatorVerification from "../models/CreatorVerification.js";
import VerificationReviewHistory from "../models/VerificationReviewHistory.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { performVerificationSubmission } from "../services/verificationSubmissionService.js";
import { sendResponse } from "../utils/response.js";
import ApiError from "../utils/ApiError.js";
import {
  assertDocumentField,
  assertEditableStatus,
  validateDraftPayload,
} from "../validators/verificationValidator.js";
import {
  openVerificationDocument,
  setPrivateDocumentHeaders,
  storeVerificationDocument,
} from "../services/privateDocumentStorageService.js";
import {
  cancelVerificationFileCleanup,
  cleanupUnreferencedVerificationFile,
  prepareVerificationFileCleanup,
  processVerificationFileCleanup,
} from "../services/verificationFileCleanupService.js";

const documentFields = ["documentFront", "documentBack", "selfieWithDocument"];

function safeDocument(metadata) {
  if (!metadata) return null;
  return {
    originalName: metadata.originalName,
    mimeType: metadata.mimeType,
    size: metadata.size,
    checksum: metadata.checksum,
    uploadedAt: metadata.uploadedAt,
  };
}

export function serializeCreatorVerification(verification) {
  return {
    id: verification._id,
    status: verification.status,
    legalFullName: verification.legalFullName,
    dateOfBirth: verification.dateOfBirth,
    country: verification.country,
    nationality: verification.nationality,
    address: verification.address,
    city: verification.city,
    phoneNumber: verification.phoneNumber,
    documentType: verification.documentType,
    documentNumber: verification.documentNumber,
    issuingCountry: verification.issuingCountry,
    expiryDate: verification.expiryDate,
    documentFront: safeDocument(verification.documentFront),
    documentBack: safeDocument(verification.documentBack),
    selfieWithDocument: safeDocument(verification.selfieWithDocument),
    ageConfirmed: verification.ageConfirmed,
    informationConfirmed: verification.informationConfirmed,
    policyAccepted: verification.policyAccepted,
    policyVersion: verification.policyVersion,
    acceptedAt: verification.acceptedAt,
    submittedAt: verification.submittedAt,
    reviewedAt: verification.reviewedAt,
    creatorVisibleMessage: verification.creatorVisibleMessage,
    rejectionReason: verification.rejectionReason,
    changesRequestedReasons: verification.changesRequestedReasons,
    createdAt: verification.createdAt,
    updatedAt: verification.updatedAt,
  };
}

async function getOrCreateVerification(creatorId) {
  return CreatorVerification.findOneAndUpdate(
    { creator: creatorId },
    { $setOnInsert: { creator: creatorId, status: "NOT_STARTED" } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

async function addCreatorHistory(verification, action, previousStatus, newStatus) {
  await VerificationReviewHistory.create({
    verification: verification._id,
    creator: verification.creator,
    action,
    previousStatus,
    newStatus,
  });
}

export const getMyVerification = asyncHandler(async (req, res) => {
  const verification = await getOrCreateVerification(req.user._id);
  return sendResponse(res, 200, "Creator verification fetched", {
    verification: serializeCreatorVerification(verification),
    creatorApprovalStatus: req.user.creatorApprovalStatus,
  });
});

export const saveVerificationDraft = asyncHandler(async (req, res) => {
  const verification = await getOrCreateVerification(req.user._id);
  assertEditableStatus(verification.status);
  const previousStatus = verification.status;
  const draft = validateDraftPayload(req.body);
  Object.assign(verification, draft);
  verification.status = verification.status === "NOT_STARTED" ? "DRAFT" : verification.status;
  if (draft.policyAccepted && !verification.acceptedAt) verification.acceptedAt = new Date();
  if (!draft.policyAccepted) verification.acceptedAt = null;
  await verification.save();
  await addCreatorHistory(verification, "DRAFT_SAVED", previousStatus, verification.status);
  return sendResponse(res, 200, "Verification draft saved", { verification: serializeCreatorVerification(verification) });
});

export const uploadVerificationFile = asyncHandler(async (req, res) => {
  const documentType = assertDocumentField(req.params.documentType);
  if (!req.file) throw new ApiError(400, "Verification document is required");
  const verification = await getOrCreateVerification(req.user._id);
  assertEditableStatus(verification.status);
  const previous = verification[documentType];
  const metadata = await storeVerificationDocument(req.file, req.user._id);
  let cleanupJob;
  try {
    cleanupJob = previous?.storageKey
      ? await prepareVerificationFileCleanup(previous.storageKey, "document_replaced")
      : null;
    const updated = await CreatorVerification.findOneAndUpdate(
      { _id: verification._id, creator: req.user._id, status: verification.status, __v: verification.__v },
      {
        $set: {
          [documentType]: metadata,
          status: verification.status === "NOT_STARTED" ? "DRAFT" : verification.status,
        },
        $inc: { __v: 1 },
      },
      { new: true, runValidators: true }
    );
    if (!updated) {
      await cancelVerificationFileCleanup(cleanupJob);
      await cleanupUnreferencedVerificationFile(metadata.storageKey, "upload_conflict");
      throw new ApiError(409, "Verification changed while the document was uploading. Please retry.");
    }
    await processVerificationFileCleanup(cleanupJob);
    return sendResponse(res, 200, "Verification document uploaded", { verification: serializeCreatorVerification(updated) });
  } catch (error) {
    if (!cleanupJob || cleanupJob.status === "PREPARED") await cancelVerificationFileCleanup(cleanupJob).catch(() => {});
    const storedMetadata = await CreatorVerification.exists({ _id: verification._id, [`${documentType}.storageKey`]: metadata.storageKey });
    if (!storedMetadata) await cleanupUnreferencedVerificationFile(metadata.storageKey, "failed_upload_update").catch(() => {});
    throw error;
  }
});
export const deleteVerificationFile = asyncHandler(async (req, res) => {
  const documentType = assertDocumentField(req.params.documentType);
  const verification = await getOrCreateVerification(req.user._id);
  assertEditableStatus(verification.status);
  const previous = verification[documentType];
  if (!previous?.storageKey) return sendResponse(res, 200, "Verification document already removed", { verification: serializeCreatorVerification(verification) });
  const cleanupJob = await prepareVerificationFileCleanup(previous.storageKey, "document_deleted");
  const updated = await CreatorVerification.findOneAndUpdate(
    { _id: verification._id, creator: req.user._id, status: verification.status, __v: verification.__v, [`${documentType}.storageKey`]: previous.storageKey },
    {
      $unset: { [documentType]: 1 },
      $set: { status: verification.status === "NOT_STARTED" ? "DRAFT" : verification.status },
      $inc: { __v: 1 },
    },
    { new: true, runValidators: true }
  );
  if (!updated) {
    await cancelVerificationFileCleanup(cleanupJob);
    throw new ApiError(409, "Verification changed while the document was being removed. Please retry.");
  }
  await processVerificationFileCleanup(cleanupJob);
  return sendResponse(res, 200, "Verification document removed", { verification: serializeCreatorVerification(updated) });
});
export const submitVerification = asyncHandler(async (req, res) => {
  const verification = await performVerificationSubmission({
    creatorId: req.user._id,
    allowedStatuses: ["NOT_STARTED", "DRAFT"],
    action: "SUBMITTED",
  });
  return sendResponse(res, 200, "Verification submitted for manual review", { verification: serializeCreatorVerification(verification) });
});

export const resubmitVerification = asyncHandler(async (req, res) => {
  const verification = await performVerificationSubmission({
    creatorId: req.user._id,
    allowedStatuses: ["CHANGES_REQUESTED"],
    action: "RESUBMITTED",
  });
  return sendResponse(res, 200, "Verification resubmitted for manual review", { verification: serializeCreatorVerification(verification) });
});
export const streamMyVerificationFile = asyncHandler(async (req, res) => {
  const documentType = assertDocumentField(req.params.documentType);
  const verification = await CreatorVerification.findOne({ creator: req.user._id });
  const metadata = verification?.[documentType];
  if (!metadata) throw new ApiError(404, "Verification document not found");
  const stream = await openVerificationDocument(metadata.storageKey);
  setPrivateDocumentHeaders(res, metadata);
  stream.on("error", (error) => res.destroy(error));
  stream.pipe(res);
});

export const verificationDocumentFields = documentFields;




