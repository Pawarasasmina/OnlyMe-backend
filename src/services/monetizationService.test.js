import test from "node:test";
import assert from "node:assert/strict";
import { isAdult, validateMonetizationPolicy } from "./monetizationService.js";
test("eligibility uses exact birthdays and never assumes adulthood", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  assert.equal(isAdult("2008-11-02", now), true);
  assert.equal(isAdult("2008-11-03", now), false);
  for (const value of [null, "invalid", "2030-01-01"]) assert.equal(isAdult(value, now), false);
});
test("admin country policy is validated and normalized without sample country defaults", () => {
  assert.deepEqual(validateMonetizationPolicy({ enabled: true, supportedCountries: [" Sri Lanka ", "sri lanka", "France"], termsVersion: "v2" }), { enabled: true, supportedCountries: ["sri lanka", "France"], termsVersion: "v2" });
  assert.throws(() => validateMonetizationPolicy({ enabled: "true", supportedCountries: [], termsVersion: "v2" }));
  assert.throws(() => validateMonetizationPolicy({ enabled: true, supportedCountries: [""], termsVersion: "v2" }));
});
