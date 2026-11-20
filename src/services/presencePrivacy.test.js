import test from "node:test";
import assert from "node:assert/strict";
import { presenceTransition, AT_SEEN_IDLE_MS, AT_SEEN_RESTORE_MS } from "./presenceService.js";
import { maskReceipts, stripActivityTimes } from "./responsePrivacyService.js";

const start = new Date("2026-11-20T10:00:00Z");
const account = () => ({ activeStatus: { isActive: true, presetKey: "at_seen", label: "At seen", startedAt: start }, presenceState: { lastActivityAt: start, revision: 1 } });
test("At seen pauses at 30 minutes, not before, and heartbeat alone does not count as activity", () => {
  assert.deepEqual(presenceTransition(account(), {}, new Date(+start + AT_SEEN_IDLE_MS - 1)), {});
  const paused = presenceTransition(account(), { foreground: true, interaction: false }, new Date(+start + AT_SEEN_IDLE_MS));
  assert.equal(paused["activeStatus.isActive"], false);
  assert.equal(+paused["presenceState.pausedAt"], +start + AT_SEEN_IDLE_MS);
  assert.equal(paused["presenceState.lastActivityAt"], undefined);
});
test("return within three hours of the pause restores; later return only offers", () => {
  const user = account(); user.activeStatus.isActive = false; user.presenceState.pausedAt = new Date(+start + AT_SEEN_IDLE_MS);
  const boundary = +user.presenceState.pausedAt + AT_SEEN_RESTORE_MS;
  const restored = presenceTransition(user, { foreground: true, interaction: true }, new Date(boundary));
  assert.equal(restored["activeStatus.isActive"], true);
  const late = presenceTransition(user, { foreground: true, interaction: true }, new Date(boundary + 1));
  assert.equal(late["activeStatus.isActive"], undefined);
  assert.equal(late["presenceState.offerAtSeen"], true);
  assert.equal(presenceTransition(user, { foreground: true, interaction: false }, new Date(boundary))["activeStatus.isActive"], undefined);
});
test("manual status or manual clearing is never replaced", () => {
  for (const activeStatus of [{ isActive: true, label: "Working", presetKey: "working" }, { isActive: false, label: "" }]) {
    const changes = presenceTransition({ activeStatus, presenceState: { lastActivityAt: start } }, { foreground: true, interaction: true }, new Date(+start + 86400000));
    assert.equal(Object.keys(changes).some(key => key.startsWith("activeStatus.")), false);
    assert.equal(changes["presenceState.offerAtSeen"], undefined);
  }
});
test("activity timestamps are removed recursively while message dates and counts remain", () => {
  const clean = stripActivityTimes({ lastSeenAt: start, user: { lastActiveAt: start, activeStatus: { label: "At seen", startedAt: start, updatedAt: start }, presenceState: { foregroundAt: start } }, message: { createdAt: "message-time" }, viewCount: 12 });
  assert.deepEqual(clean, { user: { activeStatus: { label: "At seen" } }, message: { createdAt: "message-time" }, viewCount: 12 });
});
test("direct and group receipts require both sides and the viewer to opt in", () => {
  const data = { messages: [{ senderId: "a", recipientId: "b", readAt: "private-time", delivered: true }, { senderId: "a", readBy: [{ userId: "b", readAt: "private-time" }, { userId: "c", readAt: "private-time" }], deliveredBy: [{ userId: "b", deliveredAt: "private-time" }] }] };
  const preferences = new Map([["a", true], ["b", false], ["c", true]]);
  const filtered = maskReceipts(data, "a", preferences);
  assert.equal(filtered.messages[0].readAt, null);
  assert.equal(filtered.messages[0].delivered, true);
  assert.deepEqual(filtered.messages[1].readBy, [{ userId: "c", read: true }]);
  assert.deepEqual(maskReceipts(data, "b", preferences).messages[1].readBy, []);
  preferences.set("a", false);
  assert.deepEqual(maskReceipts(data, "c", preferences).messages[1].readBy, []);
  preferences.set("a", true); preferences.set("b", true);
  assert.equal(maskReceipts(data, "a", preferences).messages[0].readAt, true);
});
