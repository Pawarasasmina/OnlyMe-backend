import test from "node:test";
import assert from "node:assert/strict";
import { orbitRecommendationTestUtils as utils } from "./orbitRecommendationService.js";

test("Orbit recommendations normalize interests safely", () => {
  assert.deepEqual(utils.normalizeList(["Fitness", " fitness ", "<Travel>", "", null]), ["fitness", "travel"]);
});

test("Orbit recommendation reasons prefer shared interests over location", () => {
  const reason = utils.reasonForCandidate({
    candidateInterests: ["fitness", "travel"],
    candidateProfile: { city: "Dubai", country: "UAE" },
    sharedInterests: ["fitness"],
    viewerCity: "Dubai",
    viewerCountry: "UAE",
  });

  assert.equal(reason.code, "SHARED_INTEREST");
  assert.equal(reason.text, "You both follow Fitness");
});

test("Orbit recommendation scoring rewards shared city and interests", () => {
  const shared = utils.scoreCandidate({
    candidateInterests: ["fitness"],
    candidateProfile: { city: "Dubai", country: "UAE", user: { isVerified: true } },
    sharedInterests: ["fitness"],
    signalSent: false,
    viewerCity: "Dubai",
    viewerCountry: "UAE",
  });
  const unrelated = utils.scoreCandidate({
    candidateInterests: [],
    candidateProfile: { city: "Paris", country: "France", user: { isVerified: false } },
    sharedInterests: [],
    signalSent: false,
    viewerCity: "Dubai",
    viewerCountry: "UAE",
  });

  assert.ok(shared > unrelated);
});

test("Orbit resonance tiers hide raw scores behind product labels", () => {
  assert.equal(utils.resonanceTierFor(70), "close");
  assert.equal(utils.resonanceTierFor(38), "aligned");
  assert.equal(utils.resonanceTierFor(12), "discover");
});

test("Orbit daily encounter key is stable for a calendar date", () => {
  assert.equal(utils.todayKey(new Date("2026-07-20T23:59:00.000Z")), "2026-07-20");
});
