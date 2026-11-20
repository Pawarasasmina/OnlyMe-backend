import assert from "node:assert/strict";
import test from "node:test";
import { paginateDiscoverRecommendations, refreshCachedDiscoverRelationships } from "./discoverController.js";

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

test("Discover paginates eligible people without repeating the first For you batch", () => {
  const people = Array.from({ length: 21 }, (_, index) => ({ userId: String(index) }));
  const options = { followedIds: new Set(["0", "2"]), excludedIds: new Set(["1", "4"]), limit: 8 };
  const first = paginateDiscoverRecommendations(people, options);
  const second = paginateDiscoverRecommendations(people, { ...options, cursor: Number(first.nextCursor) });
  const third = paginateDiscoverRecommendations(people, { ...options, cursor: Number(second.nextCursor) });
  const actual = [...first.items, ...second.items, ...third.items].map(person => person.userId);
  assert.deepEqual(actual, people.map(person => person.userId).filter(id => !["0", "1", "2", "4"].includes(id)));
  assert.equal(new Set(actual).size, 17);
  assert.equal(first.items.length, 8);
  assert.equal(second.items.length, 8);
  assert.equal(third.items.length, 1);
  assert.equal(third.nextCursor, null);
});

test("Discover excludes follow flags from every response shape and handles empty/exact pages", () => {
  const items = [
    { id: "root", isFollowing: true },
    { id: "creator", creator: { following: true } },
    { id: "actions", actions: { following: true } },
    { id: "eligible" },
  ];
  assert.deepEqual(paginateDiscoverRecommendations(items, { limit: 1 }), { items: [items[3]], nextCursor: null });
  assert.deepEqual(paginateDiscoverRecommendations([], { limit: 8 }), { items: [], nextCursor: null });
  assert.deepEqual(paginateDiscoverRecommendations(items, { followedIds: new Set(["eligible"]) }), { items: [], nextCursor: null });
});
