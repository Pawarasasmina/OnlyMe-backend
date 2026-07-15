export function expectedAccessForVerification(status) {
  if (status === "APPROVED") return { approval: "approved", isVerified: true, profileStatus: "verified" };
  if (status === "REJECTED") return { approval: "rejected", isVerified: false, profileStatus: "rejected" };
  return { approval: "pending", isVerified: false, profileStatus: "pending" };
}

export function legacyVerificationStatus(approvalStatus) {
  if (approvalStatus === "approved") return "APPROVED";
  if (approvalStatus === "rejected") return "REJECTED";
  return "NOT_STARTED";
}

export function analyzeCreatorVerificationState({ user, profile, verification, hasLegacyHistory = false }) {
  const mismatches = [];
  const normalizedApproval = user.creatorApprovalStatus || "pending";
  if (user.creatorApprovalStatus == null) mismatches.push("NULL_CREATOR_APPROVAL");
  if (!profile) mismatches.push("MISSING_CREATOR_PROFILE");
  if (!verification) {
    mismatches.push("MISSING_CREATOR_VERIFICATION");
    return { normalizedApproval, mismatches, reconciliation: "CREATE_LEGACY_RECORD" };
  }

  const expected = expectedAccessForVerification(verification.status);
  if (normalizedApproval !== expected.approval) mismatches.push("USER_APPROVAL_VS_VERIFICATION");
  if (Boolean(user.isVerified) !== expected.isVerified) mismatches.push("USER_IS_VERIFIED_VS_VERIFICATION");
  if (profile && profile.verificationStatus !== expected.profileStatus) mismatches.push("PROFILE_STATUS_VS_VERIFICATION");
  if (verification.legacyMigrated && !hasLegacyHistory) mismatches.push("MISSING_LEGACY_HISTORY");

  let reconciliation = "SYNC_FROM_VERIFICATION";
  if (normalizedApproval === "approved" && verification.status !== "APPROVED") {
    reconciliation = "PRESERVE_APPROVED_REQUIRES_MANUAL_REVIEW";
  }
  return { normalizedApproval, expected, mismatches, reconciliation };
}
