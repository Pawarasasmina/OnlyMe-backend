import { normalizeAccountType } from "../constants/accountTypeConstants.js";

export const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const PERMANENT_TEST_STORY_EXPIRY = new Date("9999-12-31T23:59:59.999Z");

export function storyExpiresAt(accountType, now = new Date()) {
  if (normalizeAccountType(accountType) === "TEST") return new Date(PERMANENT_TEST_STORY_EXPIRY);
  return new Date(new Date(now).getTime() + STORY_LIFETIME_MS);
}

export function isPermanentTestStory(accountType) {
  return normalizeAccountType(accountType) === "TEST";
}
