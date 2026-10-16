import test from "node:test";
import assert from "node:assert/strict";
import { PERMANENT_TEST_STORY_EXPIRY, STORY_LIFETIME_MS, storyExpiresAt } from "./storyExpiryService.js";

test("real and seed stories expire after 24 hours", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(storyExpiresAt("REAL", now).getTime() - now.getTime(), STORY_LIFETIME_MS);
  assert.equal(storyExpiresAt("SEED", now).getTime() - now.getTime(), STORY_LIFETIME_MS);
});

test("test account stories use the permanent expiry", () => {
  assert.equal(storyExpiresAt("TEST", new Date()).toISOString(), PERMANENT_TEST_STORY_EXPIRY.toISOString());
});
