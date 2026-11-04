import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_INTERESTS,
  validateInstinctPreferences,
  validateInterestIds,
  validateSuggestedPeoplePayload,
  validateProfileType,
} from "./onboardingValidator.js";

test("validates onboarding interests against the approved taxonomy", () => {
  assert.deepEqual(validateInterestIds({ interestIds: ["fitness", "Travel", "Business", "fitness", "<bad>"] }), [
    "Fitness",
    "Travel",
    "Business",
  ]);
});

test("validates the three onboarding profile types", () => {
  assert.deepEqual(validateProfileType({ profileType: "Creator", category: "Coach" }), { category: "Coach", contactButtons: [], profileType: "creator" });
  assert.deepEqual(validateProfileType({ profileType: "Business", category: "Shop", contactButtons: ["Call", "website", "call", "booking"] }), { category: "Shop", contactButtons: ["call", "website"], profileType: "business" });
  assert.throws(() => validateProfileType({ profileType: "Creator" }), /Choose a category/);
  assert.throws(() => validateProfileType({ profileType: "admin" }), /Personal, Creator, or Business/);
});

test("requires the onboarding interest minimum and maximum", () => {
  assert.throws(() => validateInterestIds({ interestIds: ["Fitness"] }), /at least 3/);
  assert.throws(
    () => validateInterestIds({ interestIds: Array.from({ length: MAX_INTERESTS + 1 }, (_, index) => `item-${index}`) }),
    /at least 3/
  );
  assert.throws(
    () => validateInterestIds({
      interestIds: ["Fitness", "Travel", "Business", "Beauty", "Fashion", "Wellness", "Food", "Music", "Sports"],
    }),
    /up to/
  );
});

test("validates normalized instinct preference enums", () => {
  assert.deepEqual(validateInstinctPreferences({
    showMe: "everyone",
    creatorVibe: "fresh",
    contentDepth: "both",
    discoveryRange: "global",
  }), {
    showMe: "everyone",
    creatorVibe: "fresh",
    contentDepth: "both",
    discoveryRange: "global",
  });

  assert.throws(() => validateInstinctPreferences({ showMe: "orientation" }), /unsupported/);
});

test("validates suggested person IDs without accepting client user identity", () => {
  assert.deepEqual(validateSuggestedPeoplePayload({ targetUserIds: [] }), []);
  assert.throws(() => validateSuggestedPeoplePayload({ targetUserIds: ["not-an-id"] }), /Invalid/);
});
