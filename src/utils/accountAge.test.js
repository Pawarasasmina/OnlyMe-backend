import test from "node:test";
import assert from "node:assert/strict";
import { accountAge, accountAgeBlocked, assertAccountAge } from "./accountAge.js";

test("age changes on the UTC birthday and rejects invalid calendar dates", () => {
  const now = new Date("2026-11-25T00:00:00Z");
  assert.equal(accountAge("2008-11-25", now), 18);
  assert.equal(accountAge("2008-11-26", now), 17);
  assert.equal(accountAge("2008-11-25T00:00:00Z", now), 18);
  for (const value of [null, "", "invalid", "2008-02-30", "2030-01-01"]) assert.equal(accountAge(value, now), null);
  assert.equal(accountAgeBlocked({ dateOfBirth: "2008-11-26" }, now), true);
  assert.equal(accountAgeBlocked({ dateOfBirth: "2008-11-25" }, now), false);
  assert.equal(accountAgeBlocked({}, now), false);
});

test("known minors cannot access or reactivate an account", () => {
  assert.throws(() => assertAccountAge({ dateOfBirth: "2020-01-01" }), error => error.statusCode === 403 && error.code === "MINIMUM_AGE_REQUIRED");
  assert.doesNotThrow(() => assertAccountAge({ dateOfBirth: "1990-01-01" }));
});
