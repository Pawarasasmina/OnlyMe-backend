import test from "node:test";
import assert from "node:assert/strict";
import MembershipPayment from "./MembershipPayment.js";

test("membership payments uniquely identify each membership period", () => {
  assert.ok(MembershipPayment.schema.indexes().some(([keys, options]) => keys.membership === 1 && keys.periodStart === 1 && keys.type === 1 && options.unique));
});

test("membership payment status preserves success, failure and refund history", () => {
  const values = MembershipPayment.schema.path("status").options.enum;
  assert.deepEqual(values, ["SUCCEEDED", "FAILED", "REFUNDED"]);
});
