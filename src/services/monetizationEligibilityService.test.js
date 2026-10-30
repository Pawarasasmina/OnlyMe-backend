import test from "node:test";
import assert from "node:assert/strict";
import { ageOn, assertCreatorCanMonetize, monetizationEligibility } from "./monetizationEligibilityService.js";

const approved = { status: "APPROVED", ageConfirmed: true, dateOfBirth: "1990-10-30", legalFullName: "Maya Senanayake", country: "Sri Lanka", address: "Colombo" };

test("money features calculate age at the exact birthday boundary", () => {
  assert.equal(ageOn("2008-10-31", new Date("2026-10-30T12:00:00Z")), 17);
  assert.equal(ageOn("2008-10-30", new Date("2026-10-30T12:00:00Z")), 18);
});

test("Paid Seens and Worlds require approved adult seller information", () => {
  assert.deepEqual(monetizationEligibility(approved, new Date("2026-10-30T12:00:00Z")), { allowed: true });
  assert.equal(monetizationEligibility({ ...approved, status: "PENDING_REVIEW" }).code, "SELLER_VERIFICATION_REQUIRED");
  assert.equal(monetizationEligibility({ ...approved, dateOfBirth: "2012-01-01" }, new Date("2026-10-30T12:00:00Z")).code, "SELLER_MUST_BE_ADULT");
  assert.equal(monetizationEligibility({ ...approved, address: "" }).code, "SELLER_INFORMATION_REQUIRED");
});

test("seller verification enforcement is disabled by default", async () => {
  const previous = process.env.REQUIRE_SELLER_VERIFICATION;
  delete process.env.REQUIRE_SELLER_VERIFICATION;
  try {
    await assert.doesNotReject(() => assertCreatorCanMonetize("creator-without-verification"));
  } finally {
    if (previous === undefined) delete process.env.REQUIRE_SELLER_VERIFICATION;
    else process.env.REQUIRE_SELLER_VERIFICATION = previous;
  }
});
