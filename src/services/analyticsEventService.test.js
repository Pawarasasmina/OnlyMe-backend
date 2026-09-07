import assert from "node:assert/strict";
import test from "node:test";
import { analyticsEventServiceTestUtils, PROFILE_VIEW_DEDUPE_MS, SESSION_INACTIVITY_MS, TRACKING_START_DATE } from "./analyticsEventService.js";

test("analytics constants define the deployed tracking contract", () => {
  assert.equal(TRACKING_START_DATE.toISOString(), "2026-09-03T00:00:00.000Z");
  assert.equal(SESSION_INACTIVITY_MS, 30 * 60 * 1000);
  assert.equal(PROFILE_VIEW_DEDUPE_MS, 20 * 60 * 1000);
});

test("retentionPercent calculates cohort return percentage only for cohort users", () => {
  assert.equal(analyticsEventServiceTestUtils.retentionPercent(["u1", "u2", "u3"], ["u2", "u4"]), 33.33);
  assert.equal(analyticsEventServiceTestUtils.retentionPercent([], ["u1"]), null);
});

test("funnelRates uses impressions as the rate denominator", () => {
  assert.deepEqual(analyticsEventServiceTestUtils.funnelRates({
    comments: 5,
    follows: 2,
    impressions: 100,
    reactions: 10,
    saves: 3,
    shares: 2,
    subscriptions: 1,
    support: 1,
    views: 25,
  }), {
    impressions: 100,
    views: 25,
    engagements: 20,
    follows: 2,
    subscriptions: 1,
    support: 1,
    viewRate: 25,
    engagementRate: 20,
    saveRate: 3,
    followConversion: 8,
    subscriptionConversion: 8,
  });
});

test("search metadata stores privacy-conscious normalized queries", () => {
  const safe = analyticsEventServiceTestUtils.safeMetadata("SEARCH_PERFORMED", {
    hasResults: false,
    queryLength: 12,
    resultsCount: 0,
    searchCategory: "People",
    normalizedQuery: "  Creator Name ",
  });
  assert.equal(safe.normalizedQuery, "creator name");
  assert.equal(safe.hasResults, false);
  assert.equal(safe.searchCategory, "people");

  const sensitive = analyticsEventServiceTestUtils.safeMetadata("SEARCH_PERFORMED", {
    normalizedQuery: "person@example.com",
  });
  assert.equal(sensitive.normalizedQuery, "");
});

test("device type is derived coarsely without fingerprinting", () => {
  assert.equal(analyticsEventServiceTestUtils.deviceTypeFromUserAgent("Mozilla iPhone Mobile"), "mobile");
  assert.equal(analyticsEventServiceTestUtils.deviceTypeFromUserAgent("Mozilla iPad Tablet"), "tablet");
  assert.equal(analyticsEventServiceTestUtils.deviceTypeFromUserAgent("Mozilla Windows"), "desktop");
});
