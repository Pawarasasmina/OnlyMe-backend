import assert from "node:assert/strict";
import test from "node:test";
import { exclusionState, filterRecommendationItems } from "./recommendationExclusionService.js";

test("account exclusion covers all feed shapes, including shared items", () => {
  const state = exclusionState([{ targetModel: "User", targetId: "excluded" }]);
  for (const ownerField of ["creator", "author", "user", "owner"]) {
    assert.deepEqual(filterRecommendationItems([{ id: "item", [ownerField]: { id: "excluded" } }], state), []);
  }
  assert.deepEqual(filterRecommendationItems([{ id: "share", creator: { id: "allowed" }, sharedBy: { id: "excluded" } }], state), []);
});

test("item exclusions cover originals, reshares, Seen story sources and nested story groups", () => {
  const state = exclusionState([{ targetModel: "Publication", targetId: "seen" }, { targetModel: "FeedPost", targetId: "post" }, { targetModel: "Story", targetId: "story" }]);
  const items = [{ id: "share-1", originalPostId: "post" }, { id: "story-share", sourceSeen: { _id: "seen" } }, { user: { id: "person" }, stories: [{ id: "story" }, { id: "allowed" }] }];
  const rows = filterRecommendationItems(items, state);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].stories.map(item => item.id), ["allowed"]);
  assert.equal(rows[0].storyCount, 1);
});
