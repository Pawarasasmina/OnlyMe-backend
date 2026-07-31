import mongoose from "mongoose";
import ApiError from "../utils/ApiError.js";
import { sanitizeText } from "./profileValidator.js";

export const ONBOARDING_STEPS = ["welcome", "interests", "instincts", "people", "light-your-world", "complete", "completed"];
export const SUPPORTED_ONBOARDING_ROLES = ["fan", "creator"];
export const MIN_INTERESTS = 3;
export const MAX_INTERESTS = 8;
export const MIN_PEOPLE = 3;
export const MAX_PEOPLE = 10;

export const ONBOARDING_CATEGORIES = [
  "Fitness",
  "Lifestyle",
  "Business",
  "Psychology",
  "Fashion",
  "Travel",
  "Beauty",
  "Models",
  "Wellness",
  "Books",
  "Family",
  "Technology",
  "Food",
  "Photography",
  "Music",
  "Sports",
  "Entrepreneurship",
  "Culture",
];

const categoryMap = new Map(ONBOARDING_CATEGORIES.map((category) => [category.toLowerCase(), category]));
const enumValues = {
  showMe: new Set(["men", "women", "everyone"]),
  creatorVibe: new Set(["fresh", "established", "mature", "any"]),
  contentDepth: new Set(["quick", "deep", "both"]),
  discoveryRange: new Set(["city", "country", "global"]),
  creatorStyle: new Set(["practical", "personal", "aspirational", "educational", "any"]),
};

export function requireConsumerRole(user) {
  if (!SUPPORTED_ONBOARDING_ROLES.includes(user?.role)) {
    throw new ApiError(403, "Consumer onboarding is available to fans and creators only");
  }
}

export function validateInterestIds(payload) {
  const values = payload?.interestIds ?? payload?.interests;
  if (!Array.isArray(values)) {
    throw new ApiError(400, "Choose at least 3 interests", { interestIds: "Interests must be a list" });
  }

  const interests = [...new Set(values
    .map((value) => sanitizeText(value, 40).toLowerCase())
    .filter(Boolean))]
    .map((value) => categoryMap.get(value))
    .filter(Boolean);

  if (interests.length < MIN_INTERESTS) {
    throw new ApiError(400, "Choose at least 3 interests", { interestIds: "Choose at least 3" });
  }

  if (interests.length > MAX_INTERESTS) {
    throw new ApiError(400, `Choose up to ${MAX_INTERESTS} interests`, { interestIds: `Choose up to ${MAX_INTERESTS}` });
  }

  return interests;
}

export function validateInstinctPreferences(payload = {}) {
  const source = payload.discoveryPreferences || payload.preferences || payload;
  return Object.entries(enumValues).reduce((result, [key, allowed]) => {
    const value = source[key];
    if (value === undefined || value === null || value === "") return result;
    const normalized = sanitizeText(value, 40);
    if (!allowed.has(normalized)) {
      throw new ApiError(400, "Discovery preferences contain unsupported values", {
        [key]: `Choose one of: ${Array.from(allowed).join(", ")}`,
      });
    }
    result[key] = normalized;
    return result;
  }, {});
}

export function validateSuggestedPeoplePayload(payload = {}) {
  const values = payload.targetUserIds ?? payload.userIds ?? [];
  if (!Array.isArray(values)) {
    throw new ApiError(400, "Suggested people must be a list");
  }

  if (values.length > MAX_PEOPLE) {
    throw new ApiError(400, `Choose up to ${MAX_PEOPLE} people`);
  }

  const ids = [...new Set(values.map((id) => String(id || "").trim()).filter(Boolean))];
  const invalid = ids.find((id) => !mongoose.isValidObjectId(id));
  if (invalid) {
    throw new ApiError(400, "Invalid suggested person ID");
  }

  return ids;
}

export function validateChecklistEvent(payload = {}) {
  const event = sanitizeText(payload.event, 40);
  if (![
    "watchedIntro",
    "openedOrbit",
    "openedStudio",
    "reactedToStory",
    "sharedFirstStory",
    "visitedWorld",
  ].includes(event)) {
    throw new ApiError(400, "Unsupported checklist event");
  }
  return event;
}
