import test from "node:test";
import assert from "node:assert/strict";
import { canModeratePublication, safeUserProfile } from "./publicationModeratorService.js";

test("canModeratePublication allows the creator", () => {
  assert.equal(canModeratePublication("owner", { creator: "owner", worldModerators: [] }), true);
});

test("canModeratePublication allows only moderators for that publication", () => {
  assert.equal(canModeratePublication("mod-a", { creator: "owner", worldModerators: [{ user: "mod-a" }] }), true);
  assert.equal(canModeratePublication("mod-a", { creator: "owner", worldModerators: [{ user: "mod-b" }] }), false);
});

test("safeUserProfile exposes only public profile fields", () => {
  assert.deepEqual(safeUserProfile({ _id: "u1", name: "A User", username: "auser", avatar: "avatar.jpg", isVerified: true, email: "hidden@example.test" }), {
    id: "u1",
    _id: "u1",
    displayName: "A User",
    name: "A User",
    username: "auser",
    avatar: "avatar.jpg",
    verified: true,
  });
});
