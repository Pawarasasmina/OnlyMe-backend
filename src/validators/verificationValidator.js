import ApiError from "../utils/ApiError.js";

export const DOCUMENT_FIELDS = ["documentFront", "documentBack", "selfieWithDocument"];
export const DOCUMENT_TYPES = ["national_id", "passport", "driver_license", "other"];
export const EDITABLE_STATUSES = ["NOT_STARTED", "DRAFT", "CHANGES_REQUESTED"];

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
  const requiredText = [
    "legalFullName", "country", "nationality", "address", "city", "phoneNumber",
    "documentType", "documentNumber", "issuingCountry", "policyVersion",
  ];
  const missing = requiredText.filter((field) => !String(verification[field] || "").trim());
  if (!verification.dateOfBirth) missing.push("dateOfBirth");
  if (missing.length) throw new ApiError(400, `Missing required verification fields: ${missing.join(", ")}`);
  if (!verification.documentFront) throw new ApiError(400, "Document front is required");
  if (!verification.selfieWithDocument) throw new ApiError(400, "Selfie with document is required");
  if (documentBackRequired(verification.documentType) && !verification.documentBack) {
    throw new ApiError(400, "Document back is required for this document type");
  }

  const birthDate = new Date(verification.dateOfBirth);
  const now = new Date();
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const beforeBirthday = now.getUTCMonth() < birthDate.getUTCMonth()
    || (now.getUTCMonth() === birthDate.getUTCMonth() && now.getUTCDate() < birthDate.getUTCDate());
  if (beforeBirthday) age -= 1;
  if (age < 18) throw new ApiError(400, "Creator must be at least 18 years old");
  if (!verification.ageConfirmed || !verification.informationConfirmed || !verification.policyAccepted) {
    throw new ApiError(400, "All verification declarations must be accepted");
  }
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
