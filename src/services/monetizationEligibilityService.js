import CreatorVerification from "../models/CreatorVerification.js";
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
  if (![verification.legalFullName, verification.country, verification.address].every((value) => String(value || "").trim())) return { allowed: false, code: "SELLER_INFORMATION_REQUIRED", message: "Complete your seller information before selling. This paid content remains Only you." };
  return { allowed: true };
}

export async function assertCreatorCanMonetize(creatorId, now = new Date()) {
  // Monetization is temporarily open to every creator. Set this flag to "true"
  // when mandatory seller verification is ready to be enforced again.
  if (String(process.env.REQUIRE_SELLER_VERIFICATION || "").toLowerCase() !== "true") return true;
  const verification = await CreatorVerification.findOne({ creator: creatorId }).select("status ageConfirmed dateOfBirth legalFullName country address").lean();
  const result = monetizationEligibility(verification, now);
  if (!result.allowed) throw new ApiError(403, result.message, result.code);
  return true;
}
