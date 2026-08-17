import assert from "node:assert/strict";
import test from "node:test";
import SeenEngagement, { SEEN_REACTIONS } from "./SeenEngagement.js";
import WallEngagement, { WALL_REACTIONS } from "./WallEngagement.js";
import WallShareEngagement from "./WallShareEngagement.js";

test("Seen and Wall engagements support uniquely indexed private saves", () => {
  assert.ok(SeenEngagement.schema.path("type").enumValues.includes("SAVE"));
  assert.ok(WallEngagement.schema.path("type").enumValues.includes("SAVE"));
  assert.ok(SeenEngagement.schema.indexes().some(([, options]) => options.name === "unique_seen_save_per_user" && options.unique));
  assert.ok(WallEngagement.schema.indexes().some(([, options]) => options.name === "unique_wall_save" && options.unique));
});

test("Wall reactions support the complete picker while preserving one reaction per user", () => {
  assert.deepEqual(WallEngagement.schema.path("reaction").enumValues, WALL_REACTIONS);
  assert.deepEqual(WALL_REACTIONS, ["like", "love", "care", "haha", "wow", "sad", "angry"]);
  assert.ok(WallEngagement.schema.indexes().some(([, options]) => options.name === "unique_wall_reaction" && options.unique));
});

test("Seen reactions support the prototype picker while preserving one reaction per user", () => {
  assert.deepEqual(SeenEngagement.schema.path("reaction").enumValues, SEEN_REACTIONS);
  assert.deepEqual(SEEN_REACTIONS.slice(0, 10), ["LIKE", "LOVE", "FIRE", "CLAP", "LAUGH", "SEE_YOU", "SAD", "PHONE", "STRONG", "PRAY"]);
  assert.ok(SeenEngagement.schema.indexes().some(([, options]) => options.name === "unique_seen_reaction_per_user" && options.unique));
});

test("a shared Wall post has independent reactions and saves", () => {
  assert.deepEqual(WallShareEngagement.schema.path("type").enumValues, ["REACTION", "COMMENT", "SAVE"]);
  assert.ok(WallShareEngagement.schema.indexes().some(([, options]) => options.name === "unique_wall_share_reaction" && options.unique));
  assert.ok(WallShareEngagement.schema.indexes().some(([, options]) => options.name === "unique_wall_share_save" && options.unique));
});
