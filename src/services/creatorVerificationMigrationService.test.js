import test from "node:test";
import assert from "node:assert/strict";
import { analyzeCreatorVerificationState, legacyVerificationStatus } from "./creatorVerificationMigrationService.js";

const baseUser = { creatorApprovalStatus: "pending", isVerified: false };
const baseProfile = { verificationStatus: "pending" };

test("migration reports all compatibility mismatches", () => {
  const result = analyzeCreatorVerificationState({
    user: { creatorApprovalStatus: "pending", isVerified: false },
    profile: { verificationStatus: "pending" },
    verification: { status: "APPROVED", legacyMigrated: false },
  });
  assert.deepEqual(result.mismatches.sort(), [
    "PROFILE_STATUS_VS_VERIFICATION",
    "USER_APPROVAL_VS_VERIFICATION",
    "USER_IS_VERIFIED_VS_VERIFICATION",
  ]);
  assert.equal(result.reconciliation, "SYNC_FROM_VERIFICATION");
});

test("migration never downgrades an approved creator with an existing workflow", () => {
  const result = analyzeCreatorVerificationState({
    user: { creatorApprovalStatus: "approved", isVerified: true },
    profile: { verificationStatus: "verified" },
    verification: { status: "PENDING_REVIEW", legacyMigrated: false },
  });
  assert.equal(result.reconciliation, "PRESERVE_APPROVED_REQUIRES_MANUAL_REVIEW");
});

test("migration preserves active workflow as the reconciliation authority for non-approved users", () => {
  const result = analyzeCreatorVerificationState({
    user: baseUser,
    profile: baseProfile,
    verification: { status: "CHANGES_REQUESTED", legacyMigrated: false },
  });
  assert.equal(result.reconciliation, "SYNC_FROM_VERIFICATION");
  assert.deepEqual(result.mismatches, []);
});

test("legacy mapping preserves approved access without document metadata", () => {
  assert.equal(legacyVerificationStatus("approved"), "APPROVED");
});

test("migration reports missing legacy history", () => {
  const result = analyzeCreatorVerificationState({
    user: { creatorApprovalStatus: "approved", isVerified: true },
    profile: { verificationStatus: "verified" },
    verification: { status: "APPROVED", legacyMigrated: true },
    hasLegacyHistory: false,
  });
  assert.ok(result.mismatches.includes("MISSING_LEGACY_HISTORY"));
});
