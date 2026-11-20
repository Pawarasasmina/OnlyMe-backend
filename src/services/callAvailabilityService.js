import User from "../models/User.js";
import CreatorProfile from "../models/CreatorProfile.js";
import CreatorVerification from "../models/CreatorVerification.js";
import { countryCode } from "../utils/countryCode.js";
import { getMonetizationPolicy } from "./monetizationService.js";

export const CALL_BLOCKED_COUNTRY_CODES = Object.freeze(["AE"]);
export const callsAllowedForCountries = (...countries) => !countries.some((country) => CALL_BLOCKED_COUNTRY_CODES.includes(countryCode(country)));
export const callsAllowedWithPolicy = (countries, blockedCountries = CALL_BLOCKED_COUNTRY_CODES) => !countries.some(country => blockedCountries.map(countryCode).includes(countryCode(country)) && countryCode(country));

export async function callAvailabilityForUser(userOrId) {
  const id = userOrId?._id || userOrId;
  const suppliedCountry = userOrId?.monetization?.country || userOrId?.country || "";
  const [user, verification, profile, policy] = await Promise.all([
    suppliedCountry ? null : User.findById(id).select("monetization.country").lean(),
    CreatorVerification.findOne({ creator: id, purpose: "IDENTITY", status: "APPROVED" }).select("country").lean(),
    CreatorProfile.findOne({ user: id }).select("country").lean(),
    getMonetizationPolicy(),
  ]);
  const countries = [verification?.country, suppliedCountry, user?.monetization?.country, profile?.country].filter(Boolean);
  const available = callsAllowedWithPolicy(countries, policy.blockedCallCountries);
  return { available, reason: available ? "" : "Calls are unavailable in your country", countryCode: countries.map(countryCode).find(Boolean) || "" };
}
