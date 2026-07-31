import test from "node:test";
import assert from "node:assert/strict";
import ApiError from "../utils/ApiError.js";
import {
  assertCompleteApplication,
  assertDocumentField,
  assertEditableStatus,
  documentBackRequired,
  validateDraftPayload,
} from "./verificationValidator.js";

const file = { storageKey: "creator/file.jpg", originalName: "file.jpg", mimeType: "image/jpeg", size: 10, checksum: "a", uploadedAt: new Date() };
const complete = () => ({
  legalFullName: "Adult Creator",
  dateOfBirth: new Date("1990-01-01"),
  country: "Sri Lanka",
  nationality: "Sri Lankan",
  address: "1 Main Street",
  city: "Colombo",
  phoneNumber: "+94111111111",
  documentType: "national_id",
  documentNumber: "123",
  issuingCountry: "Sri Lanka",
  policyVersion: "1.0",
  ageConfirmed: true,
  informationConfirmed: true,
  policyAccepted: true,
  documentFront: file,
  documentBack: file,
  selfieWithDocument: file,
});

test("draft validation ignores caller-provided status", () => {
  const result = validateDraftPayload({ legalFullName: " Test ", status: "APPROVED" });
  assert.equal(result.legalFullName, "Test");
  assert.equal(result.status, undefined);
});

test("document back rules are explicit", () => {
  assert.equal(documentBackRequired("national_id"), true);
  assert.equal(documentBackRequired("driver_license"), true);
  assert.equal(documentBackRequired("passport"), false);
});

test("complete application requires the back of a national ID", () => {
  const application = complete();
  application.documentBack = null;
  assert.throws(() => assertCompleteApplication(application), ApiError);
});

test("complete application requires an adult creator", () => {
  const application = complete();
  application.dateOfBirth = new Date();
  assert.throws(() => assertCompleteApplication(application), /at least 18/);
});

test("pending review is not editable", () => {
  assert.doesNotThrow(() => assertEditableStatus("DRAFT"));
  assert.throws(() => assertEditableStatus("PENDING_REVIEW"), ApiError);
});

test("only named document fields are accepted", () => {
  assert.equal(assertDocumentField("documentFront"), "documentFront");
  assert.throws(() => assertDocumentField("../../secret"), ApiError);
});
