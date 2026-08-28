import assert from "node:assert/strict";
import test from "node:test";
import { savedControllerTestUtils } from "./savedController.js";

const { SAVED_CATEGORIES, readPage } = savedControllerTestUtils;

test("saved library exposes the prototype category set without demo data", () => {
  assert.deepEqual(SAVED_CATEGORIES, ["places", "journeys", "experiences", "people", "posts", "books", "comments"]);
});

test("saved category pagination clamps unsafe limits", () => {
  assert.deepEqual(readPage({ page: "2", limit: "500" }), { page: 2, limit: 50, offset: 50 });
  assert.deepEqual(readPage({ page: "-4", limit: "0" }), { page: 1, limit: 20, offset: 0 });
});
