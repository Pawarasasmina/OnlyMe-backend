import test from "node:test";
import assert from "node:assert/strict";
import { hasWallContacts, wallAccountPolicy, wallCopySimilarity } from "./wallPublishingPolicy.js";
import { textHash, validateWallCreation } from "./wallCreationService.js";
import { canReadWallNote, wallProfileModerationFilter } from "./wallModerationAccess.js";
const now = Date.now();
test("first week boundary and Business policy use server account data", () => {
  assert.equal(wallAccountPolicy({ createdAt: new Date(now - 7 * 86400000 + 1) }, now).dailyLimit, 2);
  assert.equal(wallAccountPolicy({ createdAt: new Date(now - 7 * 86400000) }, now).dailyLimit, 5);
  assert.equal(wallAccountPolicy({ profileType: "business" }, now).isBusiness, true);
});
test("contacts and messenger references include unicode digits and obfuscation", () => {
  for (const text of ["WhatsApp me", "telegram", "wa.me/me", "t . me/name", "+94 77 123 4567", "0771234567", "\u0660\u0667\u0667\u0661\u0662\u0663\u0664\u0665\u0666\u0667", "Whats\u200bApp"]) assert.equal(hasWallContacts(text), true, text);
  assert.equal(hasWallContacts("Desk costs 123,444.50"), false);
  const user = { createdAt: new Date() };
  for (const text of ["https://example.com", "www.example.com", "example.com/path"]) assert.throws(() => validateWallCreation({ postType: "Question", text }, {}, user), { code: "WALL_NEW_ACCOUNT_LINK" });
  assert.throws(() => validateWallCreation({ postType: "Question", text: "Hi", voiceTranscript: "WhatsApp me" }, {}, user), { code: "WALL_CONTACT_DETAILS" });
});
test("duplicate normalization ignores punctuation, case, spacing and invisible separators", () => {
  assert.equal(textHash(" HELLO,   neighbour!!! "), textHash("hello neighbour"));
  assert.equal(textHash("hel\u200blo neighbour"), textHash("hello neighbour"));
  const original = "This large wooden desk is in excellent condition and available for collection in the central neighbourhood this weekend";
  assert.ok(wallCopySimilarity(original, original + " please") >= 0.85);
  assert.equal(wallCopySimilarity("Hi", "Hi"), 0);
});
test("held notes cannot be read publicly even with a guessed URL", () => {
  for (const extra of [{ moderationStatus: "PENDING_REVIEW" }, { moderationStatus: "REJECTED" }, { moderationHiddenAt: new Date() }, { visibility: "private" }]) {
    const note = { author: "owner", ...extra };
    assert.equal(canReadWallNote(note, { _id: "visitor" }), false);
    assert.equal(canReadWallNote(note, { _id: "owner" }), true);
    assert.equal(canReadWallNote(note, { _id: "moderator", role: "admin" }), true);
  }
  assert.deepEqual(wallProfileModerationFilter("owner", { _id: "owner" }), {});
  assert.equal(wallProfileModerationFilter("owner", { _id: "visitor" }).moderationHiddenAt, null);
});
