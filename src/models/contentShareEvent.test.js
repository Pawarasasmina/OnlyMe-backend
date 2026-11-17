import assert from "node:assert/strict";
import test from "node:test";
import ContentShareEvent, { SHARE_ROUTES } from "./ContentShareEvent.js";

test("private shares are unique per person and item", () => {
  const index = ContentShareEvent.schema.indexes().find(([, options]) => options.name === "unique_private_share_per_person_item");
  assert.ok(index);
  assert.deepEqual(index[0], { user: 1, contentType: 1, contentId: 1 });
  assert.equal(index[1].unique, true);
});

test("all required successful share routes are supported", () => {
  assert.deepEqual(SHARE_ROUTES, ["CHAT", "STORY", "COPY_LINK", "WHATSAPP", "TELEGRAM", "MESSAGES", "SYSTEM_SHARE"]);
});
