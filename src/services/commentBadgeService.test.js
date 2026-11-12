import test from "node:test";
import assert from "node:assert/strict";
import { attachCommentBadges, visibleMemberBadge } from "./commentBadgeService.js";
import User from "../models/User.js";
import FanProfile from "../models/FanProfile.js";
import CreatorProfile from "../models/CreatorProfile.js";

test("status badge respects privacy", () => {
  const profile = { privacySettings: { showMemberBadge: "only_me" } };
  assert.equal(visibleMemberBadge({ _id: "a" }, [profile], "b"), false);
  assert.equal(visibleMemberBadge({ _id: "a" }, [profile], "a"), true);
});

test("each commenter gets their active status icon, including replies", async t => {
  const first = "507f1f77bcf86cd799439011", second = "507f1f77bcf86cd799439012", third = "507f1f77bcf86cd799439013";
  const query = rows => ({ select() { return this; }, sort() { return this; }, lean: async () => rows });
  t.mock.method(User, "find", filter => {
    assert.equal(filter["activeStatus.isActive"], true);
    return query([
      { _id: first, activeStatus: { isActive: true, emoji: "?", label: "Reading", color: "#fff" } },
      { _id: second, activeStatus: { isActive: true, emoji: "??", label: "Working", color: "#000" } },
    ]);
  });
  t.mock.method(FanProfile, "find", () => query([{ user: second, privacySettings: { showMemberBadge: "only_me" } }]));
  t.mock.method(CreatorProfile, "find", () => query([]));
  const data = { comments: [{ author: { id: first }, replies: [{ author: { id: second } }] }, { author: { id: third } }] };
  await attachCommentBadges(data, first);
  assert.equal(data.comments[0].author.statusBadge.emoji, "?");
  assert.equal(data.comments[0].replies[0].author.statusBadge, null);
  assert.equal(data.comments[1].author.statusBadge, null);
  await attachCommentBadges(data, second);
  assert.equal(data.comments[0].replies[0].author.statusBadge.emoji, "??");
  assert.equal(JSON.stringify(data).includes("memberNumber"), false);
});
