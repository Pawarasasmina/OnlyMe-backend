import test from "node:test";
import assert from "node:assert/strict";
import { announcementEmail, normalizeAudience, personalizeAnnouncement } from "./creatorAnnouncementService.js";

test("creator announcement audience accepts supported filters and rejects unknown values", () => {
  const audience = normalizeAudience({ accountTypes: ["creator", "unknown", "creator"], approvalStatuses: ["approved", "other"], verified: false, languages: ["en", "fr"], joinedFrom: "2026-01-01" });
  assert.deepEqual(audience.accountTypes, ["creator"]);
  assert.deepEqual(audience.approvalStatuses, ["approved"]);
  assert.equal(audience.verified, false);
  assert.deepEqual(audience.languages, ["en", "fr"]);
  assert.equal(audience.joinedFrom.toISOString(), "2026-01-01T00:00:00.000Z");
});

test("creator announcement email personalizes and escapes admin content", () => {
  const output = announcementEmail({ title: "Hi {{firstName}}", message: "Use <Studio>, {{firstName}}", actionLabel: "Open", actionUrl: "/studio" }, { name: "Maya Jones" });
  assert.equal(output.subject, "Hi Maya");
  assert.match(output.text, /Use <Studio>, Maya/);
  assert.match(output.html, /Use &lt;Studio&gt;, Maya/);
  assert.doesNotMatch(output.html, /Use <Studio>/);
});

test("creator announcement personalization supports selectable creator fields", () => {
  assert.equal(personalizeAnnouncement("Hi {{firstName}} ({{fullName}}) @{{username}}", { name: "Maya Jones", username: "maya" }), "Hi Maya (Maya Jones) @maya");
});
