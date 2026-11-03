import test from "node:test";
import assert from "node:assert/strict";
import { canRestoreAccount, DELETION_GRACE_MS } from "./accountOwnershipService.js";

test("deactivation is restorable; deletion is restorable only before its deadline", () => {
  const now = new Date("2026-11-02T00:00:00Z");
  assert.equal(DELETION_GRACE_MS, 30 * 86400000);
  assert.equal(canRestoreAccount({ status: "deactivated" }, now), true);
  assert.equal(canRestoreAccount({ status: "pending_deletion", deletionScheduledAt: new Date(now.getTime() + 1) }, now), true);
  assert.equal(canRestoreAccount({ status: "pending_deletion", deletionScheduledAt: now }, now), false);
  for (const status of ["suspended", "deleted", "active"]) assert.equal(canRestoreAccount({ status }, now), false);
});
