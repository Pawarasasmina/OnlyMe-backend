import CreatorVerification from "../models/CreatorVerification.js";
import VerificationReviewHistory from "../models/VerificationReviewHistory.js";
import CreatorProfile from "../models/CreatorProfile.js";
import FanProfile from "../models/FanProfile.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { performVerificationSubmission } from "../services/verificationSubmissionService.js";
import { sendResponse } from "../utils/response.js";
import ApiError from "../utils/ApiError.js";
import User from "../models/User.js";
import { ageOn } from "../services/monetizationEligibilityService.js";
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
    category: verification.category,
    socialPages: verification.socialPages || [],
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
  const user = await User.findById(creatorId).select("dateOfBirth").lean();
  const fanProfile = await FanProfile.findOne({ user: creatorId }).lean();
  await CreatorProfile.updateOne(
    { user: creatorId },
    { $setOnInsert: {
      user: creatorId,
      verificationStatus: "not_submitted",
      coverPhoto: fanProfile?.coverPhoto || "",
      bio: fanProfile?.bio || "",
      city: fanProfile?.city || "",
      country: fanProfile?.country || "",
      phoneNumber: fanProfile?.phoneNumber || "",
      whatsapp: fanProfile?.whatsapp || "",
      orbitStatus: fanProfile?.orbitStatus || "",
      preferredLanguage: fanProfile?.preferredLanguage || "en",
      timezone: fanProfile?.timezone || "UTC",
    } },
    { upsert: true, runValidators: true }
  );
  const verification = await CreatorVerification.findOneAndUpdate(
    { creator: creatorId },
    { $setOnInsert: { creator: creatorId, status: "NOT_STARTED", dateOfBirth: user?.dateOfBirth || null } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  if (!verification.dateOfBirth && user?.dateOfBirth) {
    verification.dateOfBirth = user.dateOfBirth;
    await verification.save();
  }
  return verification;
}

export const completeSellerInformation = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select("dateOfBirth profileType").lean();
  if (!user?.dateOfBirth) throw new ApiError(409, "Add your birthday to your account before selling");
  if (ageOn(user.dateOfBirth) < 18) throw new ApiError(403, "Money features are available from age 18", "SELLER_MUST_BE_ADULT");

  const legalFullName = String(req.body.legalFullName || "").trim();
  const country = String(req.body.country || "").trim();
  const address = String(req.body.address || "").trim();
  const phoneNumber = String(req.body.phoneNumber || "").trim();
  if (!legalFullName || !country || !address || !phoneNumber) throw new ApiError(400, "Complete name, country, address and phone");
  if (legalFullName.length > 150 || country.length > 80 || address.length > 300 || phoneNumber.length > 30) throw new ApiError(400, "Seller information is too long");

  const now = new Date();
  const verification = await CreatorVerification.findOneAndUpdate(
    { creator: req.user._id },
    { $set: {
      legalFullName, country, address, phoneNumber,
      dateOfBirth: user.dateOfBirth,
      ageConfirmed: true,
      informationConfirmed: true,
      status: "APPROVED",
      submittedAt: now,
      reviewedAt: now,
      creatorVisibleMessage: "Seller information complete",
    } },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
  );
  return sendResponse(res, 200, "Seller information saved", { verification: serializeCreatorVerification(verification) });
});

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
  const approvedNeedsSellerDetails = verification.status === "APPROVED" && (
    !verification.ageConfirmed || !verification.dateOfBirth ||
    !String(verification.legalFullName || "").trim() ||
    !String(verification.country || "").trim() ||
    !String(verification.address || "").trim()
  );
  if (!approvedNeedsSellerDetails) assertEditableStatus(verification.status);
  const previousStatus = verification.status;
  const draft = validateDraftPayload(req.body);
  Object.assign(verification, draft);
  verification.status = approvedNeedsSellerDetails ? "CHANGES_REQUESTED" : verification.status === "NOT_STARTED" ? "DRAFT" : verification.status;
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
    allowedStatuses: ["CHANGES_REQUESTED", "REJECTED"],
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




