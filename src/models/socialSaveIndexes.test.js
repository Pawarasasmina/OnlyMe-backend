import assert from "node:assert/strict";
import test from "node:test";
import SeenEngagement from "./SeenEngagement.js";
import WallEngagement from "./WallEngagement.js";

test("Seen and Wall engagements support uniquely indexed private saves", () => {
  assert.ok(SeenEngagement.schema.path("type").enumValues.includes("SAVE"));
  assert.ok(WallEngagement.schema.path("type").enumValues.includes("SAVE"));
  assert.ok(SeenEngagement.schema.indexes().some(([, options]) => options.name === "unique_seen_save_per_user" && options.unique));
  assert.ok(WallEngagement.schema.indexes().some(([, options]) => options.name === "unique_wall_save" && options.unique));
});
