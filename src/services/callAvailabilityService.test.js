import test from "node:test";
import assert from "node:assert/strict";
import { callsAllowedForCountries, callsAllowedWithPolicy } from "./callAvailabilityService.js";

test("calls are unavailable when either participant is in the UAE", () => {
  assert.equal(callsAllowedForCountries("AE"), false);
  assert.equal(callsAllowedForCountries("United Arab Emirates"), false);
  assert.equal(callsAllowedForCountries("US", "UAE"), false);
});

test("calls remain available for other or unknown countries", () => {
  assert.equal(callsAllowedForCountries("US", "LK"), true);
  assert.equal(callsAllowedForCountries("", null), true);
});

test("call country policy can disable additional countries without affecting text access", () => {
  assert.equal(callsAllowedWithPolicy(["US", "Sri Lanka"], ["AE", "LK"]), false);
  assert.equal(callsAllowedWithPolicy(["AE"], []), true);
  assert.equal(callsAllowedWithPolicy(["US", "France"], ["AE"]), true);
});
