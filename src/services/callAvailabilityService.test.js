import test from "node:test";
import assert from "node:assert/strict";
import { callsAllowedForCountries } from "./callAvailabilityService.js";

test("calls are unavailable when either participant is in the UAE", () => {
  assert.equal(callsAllowedForCountries("AE"), false);
  assert.equal(callsAllowedForCountries("United Arab Emirates"), false);
  assert.equal(callsAllowedForCountries("US", "UAE"), false);
});

test("calls remain available for other or unknown countries", () => {
  assert.equal(callsAllowedForCountries("US", "LK"), true);
  assert.equal(callsAllowedForCountries("", null), true);
});
