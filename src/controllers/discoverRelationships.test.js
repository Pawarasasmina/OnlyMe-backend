import assert from "node:assert/strict";
import test from "node:test";
import { refreshCachedDiscoverRelationships } from "./discoverController.js";

test("cached Discover reflects follow and unfollow without mutating cached recommendations", () => {
  const cached = {
    recommendations: [{ id: "slide-1", userId: "arjun", creator: { id: "arjun", following: false }, actions: { following: false } }],
    following: [{ id: "arjun", following: true }],
    suggestedUsers: [{ id: "arjun", following: false }],
  };
  const followed = refreshCachedDiscoverRelationships(cached, new Set(["arjun"]));
  assert.equal(followed.recommendations[0].isFollowing, true);
  assert.equal(followed.recommendations[0].creator.following, true);
  assert.equal(followed.recommendations[0].actions.following, true);
  assert.equal(followed.suggestedUsers.length, 0);
  const unfollowed = refreshCachedDiscoverRelationships(followed, new Set());
  assert.equal(unfollowed.recommendations[0].isFollowing, false);
  assert.equal(unfollowed.recommendations[0].creator.following, false);
  assert.equal(unfollowed.recommendations[0].actions.following, false);
  assert.equal(unfollowed.following.length, 0);
  assert.equal(cached.recommendations[0].actions.following, false);
});
