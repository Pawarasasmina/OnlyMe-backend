import MembershipContentEvent from "../models/MembershipContentEvent.js";
import GroupConversation from "../models/GroupConversation.js";
import test from "node:test";
import assert from "node:assert/strict";
import PremiumMembership from "../models/PremiumMembership.js";
import Publication from "../models/Publication.js";
import Story from "../models/Story.js";
import { getMembershipLibrary } from "./membershipLibraryController.js";

const id = "507f1f77bcf86cd799439011";
function query(value) { return { select() { return this; }, sort() { return this; }, lean: async () => value }; }
async function request(membershipId = id) {
  let result;
  await getMembershipLibrary({ params: { id: membershipId }, user: { _id: "viewer" } }, { status(code) { this.code = code; return this; }, json(body) { result = body; } }, error => { throw error; });
  return result?.data;
}
test("library rejects invalid IDs before querying", async () => {
  await assert.rejects(request("invalid"), /Membership not found/);
});
test("library isolates the viewer and rejects expired or missing memberships", async t => {
  t.mock.method(PremiumMembership, "findOne", filter => { assert.equal(filter.user, "viewer"); return query(null); });
  await assert.rejects(request(), /Membership not found/);
  PremiumMembership.findOne.mock.mockImplementation(() => query({ status: "ACTIVE", currentPeriodEnd: new Date(0) }));
  await assert.rejects(request(), /no longer active/);
});
test("cancelled paid-period members retain previews; unreleased chapters stay private", async t => {
  t.mock.method(MembershipContentEvent, "bulkWrite", async () => ({}));
  t.mock.method(MembershipContentEvent, "countDocuments", async () => 0);
  t.mock.method(GroupConversation, "find", () => query([]));
  t.mock.method(PremiumMembership, "findOne", () => query({ user: "viewer", currentPeriodStart: new Date(Date.now() - 86400000), status: "CANCEL_AT_PERIOD_END", currentPeriodEnd: new Date(Date.now() + 86400000), premiumPublication: id, creator: "creator" }));
  t.mock.method(Publication, "findOne", filter => {
    assert.equal(filter.status, "PUBLISHED");
    return query({ publishedSnapshot: { chapters: [{ stableChapterId: "open", title: "Published", blocks: [] }, { stableChapterId: "future", title: "Secret", releaseMode: "SCHEDULED", releaseAt: new Date(Date.now() + 86400000) }] } });
  });
  t.mock.method(Story, "find", filter => { assert.equal(filter.audience, "world"); assert.equal(filter.creator, "creator"); return query([{ _id: "story", caption: "Members only", createdAt: new Date(), expiresAt: new Date(Date.now() + 60000) }]); });
  const result = await request();
  assert.deepEqual(result.items.map(item => item.id), ["story", "open"]);
  assert.equal(result.recap.messages, 0);
  assert.equal(result.available.chapters, 1);
});
