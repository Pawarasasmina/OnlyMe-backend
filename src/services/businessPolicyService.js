import BusinessVerification from "../models/BusinessVerification.js";
import User from "../models/User.js";
import { profileAccountType } from "../constants/profileCategoryConstants.js";
import ApiError from "../utils/ApiError.js";

export const businessVerified = (verification, now = new Date()) => verification?.status === "APPROVED" && new Date(verification.expiresAt) > now;
export async function requireVerifiedBusiness(user) {
  if (!user || user.status !== "active" || profileAccountType(user) !== "business") throw new ApiError(403, "An active Business account is required", "BUSINESS_ACCOUNT_REQUIRED");
  if (user.sellingRestrictedUntil && user.sellingRestrictedUntil > new Date()) throw new ApiError(403, "Selling is restricted for this business", "BUSINESS_SELLING_RESTRICTED");
  const verification = await BusinessVerification.findOne({ user: user._id }).lean();
  if (!businessVerified(verification)) throw new ApiError(403, "Verify your business with a current trade licence or local equivalent before publishing offers or accepting bookings", "BUSINESS_VERIFICATION_REQUIRED");
  return verification;
}
export function validateBusinessOffer(post) {
  if (!Number.isSafeInteger(Number(post.price)) || Number(post.price) <= 0 || !/^[A-Z]{3}$/.test(post.currency || "")) throw new ApiError(400, "Business offers require a real price greater than zero and a currency", "BUSINESS_OFFER_PRICE_REQUIRED");
  if (post.offerRulesAccepted !== true && post.offerRulesAccepted !== "true") throw new ApiError(400, "Confirm that your price is real and your offer contains no misleading claims", "BUSINESS_OFFER_RULES_REQUIRED");
  const text = [post.text || "", ...(post.media || []).map(item => item.transcript || "")].join(" ").normalize("NFKC");
  if (/\b(?:guaranteed\s+(?:profit|income|returns?|cure)|risk[ -]?free\s+(?:profit|investment|returns?)|100%\s*(?:guaranteed|cure))\b/i.test(text)) throw new ApiError(400, "Remove misleading guarantees from your offer", "BUSINESS_OFFER_MISLEADING_CLAIM");
}

export async function businessOfferVisibilityFilter(ownerField = "author") {
  const businesses = await User.find({ $or: [{ profileAccountType: "business" }, { profileAccountType: { $in: [null, ""] }, profileType: "business" }] }).select("_id status sellingRestrictedUntil").lean();
  const approved = await BusinessVerification.find({ user: { $in: businesses.filter(user => user.status === "active" && !(user.sellingRestrictedUntil > new Date())).map(user => user._id) }, status: "APPROVED", expiresAt: { $gt: new Date() } }).select("user").lean();
  const eligible = approved.map(row => row.user);
  const approvedIds = new Set(eligible.map(String));
  return { $nor: [
    { [ownerField]: { $in: businesses.filter(user => !approvedIds.has(String(user._id))).map(user => user._id) }, postType: { $in: ["Offering", "Buy & Sell"] } },
    { businessOffer: true, [ownerField]: { $nin: eligible } },
    { [ownerField]: { $in: businesses.map(user => user._id) }, postType: { $in: ["Offering", "Buy & Sell"] }, $or: [
      { price: { $not: { $gt: 0 } } }, { currency: { $not: /^[A-Z]{3}$/ } }, { offerRulesAccepted: { $ne: true } },
    ] },
  ] };
}
export async function enforceBusinessOffer(user, post) {
  const offer = ["Offering", "Buy & Sell"].includes(post.postType);
  if (!post.businessOffer && !(profileAccountType(user) === "business" && offer)) return false;
  await requireVerifiedBusiness(user);
  validateBusinessOffer(post);
  return true;
}
