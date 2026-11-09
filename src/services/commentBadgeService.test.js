import test from "node:test";
import assert from "node:assert/strict";
import { attachCommentBadges, visibleMemberBadge } from "./commentBadgeService.js";
import Publication from "../models/Publication.js";
import FanProfile from "../models/FanProfile.js";
import CreatorProfile from "../models/CreatorProfile.js";

test("own World badge respects privacy", () => {
  const profile = { privacySettings: { showMemberBadge: "only_me" } };
  assert.equal(visibleMemberBadge({ _id: "a" }, [profile], "b"), false);
  assert.equal(visibleMemberBadge({ _id: "a" }, [profile], "a"), true);
});

test("each commenter gets one own profile World icon, including replies", async t => {
  const first = "507f1f77bcf86cd799439011", second = "507f1f77bcf86cd799439012", third = "507f1f77bcf86cd799439013";
  const query = rows => ({ select() { return this; }, sort() { return this; }, lean: async () => rows });
  const world = (creator, emoji, id) => ({ _id: id, creator, publishedSnapshot: { metadata: { planet: { emoji } } } });
  t.mock.method(Publication, "find", filter => {
    assert.equal(filter.kind, "PREMIUM_WORLD");
    assert.equal(filter.publishedSnapshot.$exists, true);
    return query([world(first, "?", "one"), world(second, "??", "two"), world(first, "ignored", "duplicate")]);
  });
  t.mock.method(FanProfile, "find", () => query([{ user: second, privacySettings: { showMemberBadge: "only_me" } }]));
  t.mock.method(CreatorProfile, "find", () => query([]));
  const data = { comments: [{ author: { id: first }, replies: [{ author: { id: second } }] }, { author: { id: third } }] };
  await attachCommentBadges(data, first);
  assert.deepEqual(data.comments[0].author.memberBadges.map(x => x.emoji), ["?"]);
  assert.deepEqual(data.comments[0].replies[0].author.memberBadges, []);
  assert.deepEqual(data.comments[1].author.memberBadges, []);
  await attachCommentBadges(data, second);
  assert.equal(data.comments[0].replies[0].author.memberBadges[0].emoji, "??");
  assert.equal(JSON.stringify(data).includes("memberNumber"), false);
});
