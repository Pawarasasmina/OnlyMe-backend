import CreatorVerification from "../models/CreatorVerification.js";
import User from "../models/User.js";
import { profileAccountType } from "../constants/profileCategoryConstants.js";
import ApiError from "../utils/ApiError.js";

export function ageOn(dateOfBirth, now = new Date()) {
  const birth = new Date(dateOfBirth);
  if (Number.isNaN(birth.getTime())) return 0;
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  if (now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())) age -= 1;
  return Math.max(0, age);
}

export function monetizationEligibility(verification, now = new Date()) {
  if (!verification || verification.status !== "APPROVED") return { allowed: false, code: "SELLER_VERIFICATION_REQUIRED", message: "Complete Verification before selling. This paid content remains Only you." };
  if (!verification.ageConfirmed || ageOn(verification.dateOfBirth, now) < 18) return { allowed: false, code: "SELLER_MUST_BE_ADULT", message: "Money features require a verified age of 18 or older. This paid content remains Only you." };
  return { allowed: true };
}

export async function assertCreatorCanMonetize(creatorId, now = new Date()) {
  const [user, verification] = await Promise.all([
    User.findById(creatorId).select("profileAccountType profileType creatorApprovalStatus").lean(),
    CreatorVerification.findOne({ creator: creatorId, purpose: "IDENTITY" }).select("status ageConfirmed dateOfBirth stateSyncPending").lean(),
  ]);
  if (!user || !["creator", "business"].includes(profileAccountType(user))) {
    throw new ApiError(403, "Switch to a Creator or Business profile before enabling money features", "PROFESSIONAL_PROFILE_REQUIRED");
  }
  if (verification?.stateSyncPending) {
    throw new ApiError(403, "Verification approval is still being finalized", "SELLER_VERIFICATION_REQUIRED");
  }
  const result = monetizationEligibility(verification, now);
  if (!result.allowed) throw new ApiError(403, result.message, result.code);
  return true;
}
