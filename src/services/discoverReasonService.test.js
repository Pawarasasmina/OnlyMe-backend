import assert from "node:assert/strict";
import test from "node:test";
import { discoverCardReason } from "./discoverReasonService.js";

test("eligible facts produce all five prototype reasons deterministically", () => {
  const facts = { dream: { title: "Build a studio", status: "active" }, savedSeen: { saveCount: 650 }, city: "Dubai", viewerCity: "dubai", activeStatus: { isActive: true, label: "At seen" }, followedBy: [{ id: "friend", name: "Maya Smith" }] };
  const codes = new Set();
  for (let i = 0; i < 50; i++) {
    const input = { ...facts, id: String(i) };
    const result = discoverCardReason(input);
    codes.add(result.code);
    assert.deepEqual(discoverCardReason(input), result);
  }
  assert.deepEqual([...codes].sort(), ["ACTIVE_NOW", "DREAM", "FOLLOWED_BY", "SAME_CITY", "SEEN_SAVED"]);
});

test("unsupported facts never become recommendation claims", () => {
  assert.deepEqual(discoverCardReason({ id: "a", dream: { title: "Done", status: "completed" }, savedSeen: { saveCount: 499 }, city: "Dubai", viewerCity: "Colombo", activeStatus: { isActive: true, label: "At seen", expiresAt: "2020-01-01" }, followedBy: [] }), { code: "DISCOVER_PROFILE" });
  assert.deepEqual(discoverCardReason({ savedSeen: { saveCount: 500 } }), { code: "SEEN_SAVED", count: 500 });
  assert.deepEqual(discoverCardReason({ city: "", viewerCity: "Dubai", activeStatus: { isActive: false, label: "At seen" } }), { code: "DISCOVER_PROFILE" });
});
