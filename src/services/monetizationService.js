import PlatformSetting from "../models/PlatformSetting.js";
import CreatorVerification from "../models/CreatorVerification.js";
import PayoutBankApplication from "../models/PayoutBankApplication.js";
import Gift from "../models/Gift.js";
import GiftPreference from "../models/GiftPreference.js";
import GiftCategory from "../models/GiftCategory.js";
import User from "../models/User.js";
import CreatorProfile from "../models/CreatorProfile.js";
import { profileAccountType } from "../constants/profileCategoryConstants.js";
import ApiError from "../utils/ApiError.js";
import { countriesMatch, countryCode } from "../utils/countryCode.js";

export const MONETIZATION_POLICY_KEY = "MONETIZATION_POLICY";
export const COUNTRY_FEATURES = ["directAccessCalls", "payouts", "businessAccounts", "buySell", "gifts"];
const defaults = { enabled: true, supportedCountries: [], blockedCallCountries: ["AE"], countryFeatureOverrides: { AE: { directAccessCalls: false } }, termsVersion: "monetization-v1", topCreatorPayoutThresholdUsd: 1000 };
export async function getMonetizationPolicy() {
  const record = await PlatformSetting.findOne({ key: MONETIZATION_POLICY_KEY }).lean();
  const policy = { ...defaults, ...record?.value };
  policy.countryFeatureOverrides = { ...defaults.countryFeatureOverrides, ...(record?.value?.countryFeatureOverrides || {}) };
  for (const code of policy.blockedCallCountries || []) policy.countryFeatureOverrides[code] = { ...policy.countryFeatureOverrides[code], directAccessCalls: false };
  return policy;
}
export function countryFeaturePolicy(policy, country) {
  const code = countryCode(country);
  return { countryCode: code || "", features: Object.fromEntries(COUNTRY_FEATURES.map((feature) => [feature, policy.countryFeatureOverrides?.[code]?.[feature] !== false])) };
}
export function validateMonetizationPolicy(payload) {
  if (typeof payload.enabled !== "boolean" || !Array.isArray(payload.supportedCountries) || payload.supportedCountries.length > 250) throw new ApiError(400, "Provide an enabled flag and up to 250 payout countries");
  if (payload.supportedCountries.some(country => typeof country !== "string" || !country.trim() || country.trim().length > 80)) throw new ApiError(400, "Country names must be 1–80 characters");
  const countries = [...new Map(payload.supportedCountries.map(country => [country.trim().toLowerCase(), country.trim()])).values()];
  const blocked = payload.blockedCallCountries ?? defaults.blockedCallCountries;
  if (!Array.isArray(blocked) || blocked.length > 250 || blocked.some(value => typeof value !== "string" || !countryCode(value))) throw new ApiError(400, "Choose valid countries for call restrictions");
  const blockedCallCountries = [...new Set(blocked.map(countryCode))];
  const rawOverrides = payload.countryFeatureOverrides ?? {};
  if (!rawOverrides || typeof rawOverrides !== "object" || Array.isArray(rawOverrides) || Object.keys(rawOverrides).length > 250) throw new ApiError(400, "Provide valid per-country feature switches");
  const countryFeatureOverrides = {};
  for (const [country, switches] of Object.entries(rawOverrides)) {
    const code = countryCode(country);
    if (!code || !switches || typeof switches !== "object" || Array.isArray(switches)) throw new ApiError(400, "Choose valid countries and feature switches");
    countryFeatureOverrides[code] = {};
    for (const feature of COUNTRY_FEATURES) if (Object.hasOwn(switches, feature)) {
      if (typeof switches[feature] !== "boolean") throw new ApiError(400, `${feature} must be on or off`);
      countryFeatureOverrides[code][feature] = switches[feature];
    }
  }
  for (const code of blockedCallCountries) countryFeatureOverrides[code] = { ...countryFeatureOverrides[code], directAccessCalls: false };
  const termsVersion = String(payload.termsVersion || "").trim();
  if (!/^[a-zA-Z0-9._-]{1,60}$/.test(termsVersion)) throw new ApiError(400, "Provide a valid terms version");
  const topCreatorPayoutThresholdUsd = Number(payload.topCreatorPayoutThresholdUsd ?? defaults.topCreatorPayoutThresholdUsd);
  if (!Number.isFinite(topCreatorPayoutThresholdUsd) || topCreatorPayoutThresholdUsd < 0 || topCreatorPayoutThresholdUsd > 10000000) throw new ApiError(400, "Top creator payout threshold must be between $0 and $10,000,000");
  return { enabled: payload.enabled, supportedCountries: countries, blockedCallCountries, countryFeatureOverrides, termsVersion, topCreatorPayoutThresholdUsd: Math.round(topCreatorPayoutThresholdUsd * 100) / 100 };
}
export function isAdult(dateOfBirth, now = new Date()) {
  if (!dateOfBirth) return false;
  const dob = new Date(dateOfBirth);
  if (!Number.isFinite(dob.getTime())) return false;
  return dob.getTime() <= Date.UTC(now.getUTCFullYear() - 18, now.getUTCMonth(), now.getUTCDate());
}
export function monetizationDateOfBirth(user, verification) {
  const approvedIdentity = verification?.status === "APPROVED" && !verification.stateSyncPending;
  return (approvedIdentity ? verification.dateOfBirth : null) || user.monetization?.dateOfBirth || user.dateOfBirth || null;
}
export async function monetizationSummary(user) {
  const [policy, verification, gifts, preference, activeCategories, bank, creatorProfile] = await Promise.all([
    getMonetizationPolicy(),
    CreatorVerification.findOne({ creator: user._id, purpose: "IDENTITY" }).select("dateOfBirth country status stateSyncPending").lean(),
    Gift.find({ isActive: true }).select("_id category").lean(),
    GiftPreference.findOne({ user: user._id }).select("enabledGifts").lean(),
    GiftCategory.distinct("_id", { isActive: true }),
    PayoutBankApplication.findOne({ user: user._id }).select("status country").lean(),
    CreatorProfile.findOne({ user: user._id }).select("directAccessEnabled").lean(),
  ]);
  const approvedIdentity = verification?.status === "APPROVED" && !verification.stateSyncPending;
  const dob = monetizationDateOfBirth(user, verification);
  const country = bank?.status === "APPROVED" && bank.country ? bank.country : user.monetization?.country || (approvedIdentity ? verification.country : "") || "";
  const age = isAdult(dob);
  const countryAllowed = policy.supportedCountries.length
    ? policy.supportedCountries.some(value => countriesMatch(value, country))
    : Boolean(bank?.status === "APPROVED" && bank.country && countriesMatch(bank.country, country));
  const terms = Boolean(user.monetization?.termsAcceptedAt && user.monetization?.termsVersion === policy.termsVersion);
  const standing = user.status === "active" && !(user.loginRestrictedUntil > new Date()) && !(user.messagingRestrictedUntil > new Date());
  const enabled = policy.enabled && approvedIdentity && age && countryAllowed && terms && standing;
  const type = profileAccountType(user);
  const seller = approvedIdentity && ["creator", "business"].includes(type);
  const verified = Boolean(approvedIdentity);
  const allowedCategories = new Set(activeCategories.map(String));
  const allowedGifts = preference ? new Set(preference.enabledGifts.map(String)) : null;
  const giftsAvailable = gifts.some(gift => (!gift.category || allowedCategories.has(String(gift.category))) && (!allowedGifts || allowedGifts.has(String(gift._id))));
  const countryPolicy = countryFeaturePolicy(policy, country);
  return { enabled, policy, countryPolicy, accountType: type, category: user.profileCategory || "", country, hasDateOfBirth: Boolean(dob), dateOfBirth: dob ? new Date(dob).toISOString().slice(0, 10) : "", eligibility: { age, country: countryAllowed, terms, standing }, verified, payoutsReady: Boolean(verified && bank?.status === "APPROVED" && countryPolicy.features.payouts), tools: { gifts: enabled && giftsAvailable && countryPolicy.features.gifts, dream: enabled && giftsAvailable && countryPolicy.features.gifts, paidSeens: enabled && seller, directAccess: enabled && seller && type !== "personal" && Boolean(creatorProfile?.directAccessEnabled), directAccessCalls: enabled && countryPolicy.features.directAccessCalls, world: enabled && seller && type !== "personal", offers: enabled && type === "business" && countryPolicy.features.buySell, businessAccounts: countryPolicy.features.businessAccounts, buySell: countryPolicy.features.buySell, payouts: countryPolicy.features.payouts }, sellerReady: seller };
}

export async function requireCountryFeature(userId, feature) {
  if (!COUNTRY_FEATURES.includes(feature)) throw new ApiError(500, "Unknown country feature");
  const user = await User.findById(userId).select("monetization country");
  if (!user) throw new ApiError(404, "Account is unavailable");
  const summary = await monetizationSummary(user);
  if (summary.countryPolicy.features[feature] === false) throw new ApiError(403, "This feature is unavailable in your country", "FEATURE_NOT_AVAILABLE_IN_COUNTRY");
  return summary.countryPolicy;
}
export async function completeMonetizationEligibility(user, payload) {
  const current = await monetizationSummary(user);
  const policy = current.policy;
  if (!["creator", "business"].includes(current.accountType)) throw new ApiError(403, "Switch to a Creator or Business profile before enabling monetization", "PROFESSIONAL_PROFILE_REQUIRED");
  // Details and consent can be saved before verification. Receiving money is
  // still gated by verified identity and country approval in the summary.
  const country = policy.supportedCountries.length
    ? policy.supportedCountries.find(value => countriesMatch(value, payload.country))
    : countryCode(payload.country);
  if (!policy.enabled) throw new ApiError(409, "Monetization is temporarily unavailable");
  if (!country) throw new ApiError(400, policy.supportedCountries.length ? "Choose a supported payout country" : "Enter a valid payout country");
  if (payload.acceptTerms !== true || payload.termsVersion !== policy.termsVersion) throw new ApiError(400, "Accept the current Monetization Terms");
  const date = current.dateOfBirth || payload.dateOfBirth;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !Number.isFinite(new Date(date).getTime()) || new Date(date).toISOString().slice(0, 10) !== date || !isAdult(date)) throw new ApiError(400, "Monetization is available from age 18");
  if (!current.eligibility.standing) throw new ApiError(403, "Resolve your account restrictions before enabling monetization");
  // The birthday can be supplied once; an approved identity record takes precedence over edits.
  const updated = await User.findOneAndUpdate({ _id: user._id, status: "active", ...(current.hasDateOfBirth ? {} : { "monetization.dateOfBirth": null }) }, { $set: { "monetization.dateOfBirth": new Date(date), "monetization.country": country, "monetization.termsAcceptedAt": new Date(), "monetization.termsVersion": policy.termsVersion } }, { new: true, runValidators: true });
  if (!updated) throw new ApiError(409, "Account details changed. Please refresh and try again.");
  return monetizationSummary(updated);
}

export async function requireMonetization(userId, feature) {
  const user = await User.findById(userId).select("+accountType");
  if (!user) throw new ApiError(404, "Earning account is unavailable");
  const summary = await monetizationSummary(user);
  if (!summary.enabled || !summary.tools[feature]) throw new ApiError(403, "This account must complete monetization eligibility before receiving this payment", "MONETIZATION_NOT_ELIGIBLE");
  return summary;
}
