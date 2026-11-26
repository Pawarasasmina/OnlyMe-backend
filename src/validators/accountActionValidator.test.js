import assert from "node:assert/strict";
import test from "node:test";
import { requireAccountAction } from "./accountActionValidator.js";

test("account actions require an entered reason and explicit confirmation", () => {
  for (const reason of [undefined, null, 123, "", "  ", "ab", "a".repeat(501)]) {
    assert.throws(() => requireAccountAction({ reason, confirmed: true }), { statusCode: 400 });
  }
  for (const confirmed of [undefined, false, "true", 1]) {
    assert.throws(() => requireAccountAction({ reason: "Policy violation", confirmed }), { statusCode: 400 });
  }
  assert.equal(requireAccountAction({ reason: "  Policy violation  ", confirmed: true }), "Policy violation");
});
