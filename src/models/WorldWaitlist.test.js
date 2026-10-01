import test from "node:test";
import assert from "node:assert/strict";
import WorldWaitlist from "./WorldWaitlist.js";

test("Premium World waiting list is FIFO and unique per waiting fan", () => {
  const indexes = WorldWaitlist.schema.indexes();
  assert.ok(indexes.some(([keys]) => keys.publication === 1 && keys.status === 1 && keys.createdAt === 1));
  assert.ok(indexes.some(([keys, options]) => keys.publication === 1 && keys.user === 1 && options.unique && options.partialFilterExpression?.status === "WAITING"));
  assert.ok(WorldWaitlist.schema.path("holdLedgerEntry"));
});
