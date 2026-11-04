import test from "node:test";
import assert from "node:assert/strict";
import MembershipContentEvent from "../models/MembershipContentEvent.js";
import GroupConversation from "../models/GroupConversation.js";
import GroupMessage from "../models/GroupMessage.js";
import { getMembershipRecap, publishedChapterEvents, recordMembershipContentEvents, recordWorldStory } from "./membershipRecapService.js";

test("recap counts the current paid period and only the viewer's World circles", async t => {
  const membership = { creator: "creator", user: "viewer", premiumPublication: "world", currentPeriodStart: "2026-10-09T00:00:00Z", currentPeriodEnd: "2026-11-08T00:00:00Z" };
  const now = new Date("2026-10-30T00:00:00Z");
  t.mock.method(GroupConversation, "find", filter => {
    assert.deepEqual(filter, { worldPublication: "world", members: "viewer", deletedAt: null });
    return { select() { return this; }, lean: async () => [{ _id: "circle" }] };
  });
  t.mock.method(MembershipContentEvent, "countDocuments", async filter => {
    assert.equal(filter.occurredAt.$gte.toISOString(), "2026-10-09T00:00:00.000Z");
    assert.equal(filter.occurredAt.$lt.toISOString(), now.toISOString());
    if (filter.kind === "STORY") { assert.equal(filter.creator, "creator"); return 8; }
    assert.deepEqual(filter.publication.$in, ["world", "included"]);
    return 1;
  });
  t.mock.method(GroupMessage, "countDocuments", async filter => {
    assert.deepEqual(filter.group.$in, ["circle"]);
    assert.equal(filter.deletedAt, null);
    assert.equal(filter.deletedFor.$ne, "viewer");
    return 38;
  });
  assert.deepEqual(await getMembershipRecap(membership, ["world", "included"], now), { stories: 8, chapters: 1, messages: 38 });
});

test("no World circles returns zero without counting unrelated messages", async t => {
  t.mock.method(GroupConversation, "find", () => ({ select() { return this; }, lean: async () => [] }));
  t.mock.method(MembershipContentEvent, "countDocuments", async () => 0);
  t.mock.method(GroupMessage, "countDocuments", () => { throw new Error("Unrelated messages must not be queried"); });
  assert.deepEqual(await getMembershipRecap({ currentPeriodStart: "2026-10-01", currentPeriodEnd: "2026-11-01" }, [], new Date("2026-10-30")), { stories: 0, chapters: 0, messages: 0 });
});

test("chapter events use stable IDs and scheduled release dates, never drafts", () => {
  const publication = { _id: "world", creator: "creator", status: "PUBLISHED", publishedAt: "2026-10-01", publishedSnapshot: { chapters: [{ stableChapterId: "first" }, { stableChapterId: "later", releaseMode: "SCHEDULED", releaseAt: "2026-11-01" }] } };
  assert.deepEqual(publishedChapterEvents({ ...publication, status: "DRAFT" }), []);
  const events = publishedChapterEvents(publication);
  assert.equal(events[0].key, "chapter:world:first");
  assert.equal(events[1].occurredAt.toISOString(), "2026-11-01T00:00:00.000Z");
});

test("story metadata is persisted independently of expiry and deduplicated on retry", async t => {
  const writes = [];
  t.mock.method(MembershipContentEvent, "bulkWrite", async operations => writes.push(...operations));
  await recordWorldStory({ _id: "story", creator: "creator", audience: "world", createdAt: new Date("2026-10-20") });
  await recordWorldStory({ _id: "public", creator: "creator", audience: "everyone" });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].updateOne.filter.key, "story:story");
  assert.equal(writes[0].updateOne.upsert, true);
  assert.equal(writes[0].updateOne.update.$setOnInsert.occurredAt.toISOString(), "2026-10-20T00:00:00.000Z");
  assert.equal("expiresAt" in writes[0].updateOne.update.$setOnInsert, false);
  await recordMembershipContentEvents([]);
  assert.equal(writes.length, 1);
});
