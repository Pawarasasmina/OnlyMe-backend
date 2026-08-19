import ApiError from "../utils/ApiError.js";

export const DOCUMENT_FIELDS = ["documentFront", "documentBack", "selfieWithDocument"];
export const DOCUMENT_TYPES = ["national_id", "passport", "driver_license", "other"];
export const EDITABLE_STATUSES = ["NOT_STARTED", "DRAFT", "CHANGES_REQUESTED", "REJECTED"];

const text = (value, field, max) => {
  const normalized = String(value ?? "").trim();
  if (normalized.length > max) throw new ApiError(400, `${field} cannot exceed ${max} characters`);
  return normalized;
};

const optionalDate = (value, field) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ApiError(400, `${field} must be a valid date`);
  return date;
};

export function validateDraftPayload(payload = {}) {
  const documentType = String(payload.documentType ?? "").trim();
  if (documentType && !DOCUMENT_TYPES.includes(documentType)) {
    throw new ApiError(400, "Unsupported document type");
  }

  return {
    category: text(payload.category, "Creator category", 40),
    socialPages: Array.isArray(payload.socialPages) ? payload.socialPages.slice(0, 5).map((item) => ({
      platform: text(item?.platform, "Social platform", 30),
      handle: text(item?.handle, "Social handle", 120),
    })).filter((item) => item.platform && item.handle) : [],
    legalFullName: text(payload.legalFullName, "Legal full name", 150),
    dateOfBirth: optionalDate(payload.dateOfBirth, "Date of birth"),
    country: text(payload.country, "Country", 80),
    nationality: text(payload.nationality, "Nationality", 80),
    address: text(payload.address, "Address", 300),
    city: text(payload.city, "City", 80),
    phoneNumber: text(payload.phoneNumber, "Phone number", 30),
    documentType,
    documentNumber: text(payload.documentNumber, "Document number", 100),
    issuingCountry: text(payload.issuingCountry, "Issuing country", 80),
    expiryDate: optionalDate(payload.expiryDate, "Expiry date"),
    ageConfirmed: payload.ageConfirmed === true,
    informationConfirmed: payload.informationConfirmed === true,
    policyAccepted: payload.policyAccepted === true,
    policyVersion: text(payload.policyVersion, "Policy version", 40),
  };
}

export function documentBackRequired(documentType) {
  return ["national_id", "driver_license"].includes(documentType);
}

export function assertCompleteApplication(verification) {
  if (!String(verification.category || "").trim()) throw new ApiError(400, "Choose what you create");
  if (!verification.socialPages?.some((item) => String(item.handle || "").trim())) throw new ApiError(400, "Add at least one creator page");
  if (!verification.documentFront) throw new ApiError(400, "Upload an identity document");
}

export function assertDocumentField(value) {
  if (!DOCUMENT_FIELDS.includes(value)) throw new ApiError(400, "Unsupported verification document type");
  return value;
}

export function assertEditableStatus(status) {
  if (!EDITABLE_STATUSES.includes(status)) {
    throw new ApiError(409, "Verification cannot be edited in its current status");
  }
}
