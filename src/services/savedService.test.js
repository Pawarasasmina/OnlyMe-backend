import assert from "node:assert/strict";
import test from "node:test";
import { isBookContent } from "./savedService.js";

test("saved books use semantic Books or Reading content fields", () => {
  assert.equal(isBookContent({ category: "Books" }), true);
  assert.equal(isBookContent({ topic: "Reading" }), true);
  assert.equal(isBookContent({ tags: ["reading"] }), true);
  assert.equal(isBookContent({ category: "Travel", topic: "Local tips" }), false);
});
