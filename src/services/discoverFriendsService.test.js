import assert from "node:assert/strict";
import test from "node:test";
import {
  mutualFollowIds,
  serializeDiscoverFriend,
  sortDiscoverFriends,
} from "./discoverFriendsService.js";

const viewerId = "000000000000000000000001";
const mutualId = "000000000000000000000002";
const oneWayId = "000000000000000000000003";
const blockedId = "000000000000000000000004";

test("mutualFollowIds returns only two-way follows", () => {
  const ids = mutualFollowIds(
    [{ target: mutualId }, { target: oneWayId }, { target: viewerId }, { target: blockedId }],
    [{ actor: mutualId }, { actor: blockedId }],
    viewerId,
    new Set([blockedId]),
  );

  assert.deepEqual([...ids], [mutualId]);
});

test("serializeDiscoverFriend exposes active unseen story state without duplicates", () => {
  const friend = serializeDiscoverFriend(
    { _id: mutualId, name: "Mia Reed", username: "mia", avatar: "/mia.jpg", role: "creator", isVerified: true },
    { category: "Photography", profileVisibility: "public", privacySettings: {}, updatedAt: "2026-08-04T12:00:00.000Z" },
    {
      stories: [
        { id: "story-1", viewed: true, createdAt: "2026-08-04T10:00:00.000Z" },
        { id: "story-2", viewed: false, createdAt: "2026-08-04T11:00:00.000Z" },
      ],
    },
  );

  assert.equal(friend.isMutualFollow, true);
  assert.equal(friend.firstName, "Mia");
  assert.equal(friend.hasActiveStory, true);
  assert.equal(friend.hasUnseenStory, true);
  assert.equal(friend.activeStoryCount, 2);
  assert.equal(friend.firstUnseenStoryId, "story-2");
  assert.equal(friend.profileUrl, "/profile/mia");
});

test("sortDiscoverFriends is stable: unseen stories, seen stories, then no story", () => {
  const sorted = sortDiscoverFriends([
    { id: "c", displayName: "Charlie", hasActiveStory: false, hasUnseenStory: false, updatedAt: "2026-08-04T09:00:00.000Z" },
    { id: "b", displayName: "Bianca", hasActiveStory: true, hasUnseenStory: false, updatedAt: "2026-08-04T10:00:00.000Z" },
    { id: "a", displayName: "Amal", hasActiveStory: true, hasUnseenStory: true, updatedAt: "2026-08-04T08:00:00.000Z" },
  ]);

  assert.deepEqual(sorted.map((friend) => friend.id), ["a", "b", "c"]);
});
