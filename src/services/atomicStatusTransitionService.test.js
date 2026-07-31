import test from "node:test";
import assert from "node:assert/strict";
import { claimAtomicStatusTransition } from "./atomicStatusTransitionService.js";

function inMemoryRepository(initialStatus) {
  const state = { _id: "verification-1", status: initialStatus };
  return {
    state,
    async findOneAndUpdate(filter, update) {
      await new Promise((resolve) => setImmediate(resolve));
      if (state._id !== filter._id || state.status !== filter.status) return null;
      Object.assign(state, update.$set);
      return { ...state };
    },
  };
}

test("concurrent approve versus reject permits exactly one decision", async () => {
  const repository = inMemoryRepository("PENDING_REVIEW");
  const approve = claimAtomicStatusTransition({ repository, id: "verification-1", expectedStatus: "PENDING_REVIEW", targetStatus: "APPROVED", update: {} });
  const reject = claimAtomicStatusTransition({ repository, id: "verification-1", expectedStatus: "PENDING_REVIEW", targetStatus: "REJECTED", update: {} });
  const results = await Promise.allSettled([approve, reject]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason.statusCode === 409).length, 1);
  assert.ok(["APPROVED", "REJECTED"].includes(repository.state.status));
});
