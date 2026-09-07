import assert from "node:assert/strict";
import test from "node:test";
import { buildAnalyticsPdf, buildBuckets, parseAnalyticsRange } from "./adminAnalyticsService.js";

test("parseAnalyticsRange defaults to a valid 30 day report window", () => {
  const range = parseAnalyticsRange({});
  assert.equal(range.granularity, "day");
  assert.ok(range.startDate <= range.endDate);
  assert.ok(range.previousStartDate < range.startDate);
});

test("parseAnalyticsRange rejects invalid dates", () => {
  assert.throws(() => parseAnalyticsRange({ startDate: "bad", endDate: new Date().toISOString() }), /Invalid analytics date range/);
});

test("buildBuckets includes zero-fill bucket keys for daily charts", () => {
  const buckets = buildBuckets(new Date("2026-09-01T00:00:00.000Z"), new Date("2026-09-03T23:59:59.999Z"), "day");
  assert.deepEqual(buckets.map((bucket) => bucket.key), ["2026-09-01", "2026-09-02", "2026-09-03"]);
});

test("buildAnalyticsPdf returns a real PDF buffer", () => {
  const report = {
    range: { startDate: new Date("2026-09-01T00:00:00.000Z"), endDate: new Date("2026-09-30T23:59:59.999Z"), granularity: "day" },
    summary: { totalUsers: 40, newUsers: 8, activeUsers: 21, totalCreators: 18, verifiedCreators: 5, totalPublishedContent: 16, postsCreated: 7, totalEngagements: 120, engagementRate: 14.2, activeSubscriptions: 2, activePremiumMemberships: 1 },
    accountDistribution: [{ label: "fan", value: 10 }, { label: "creator", value: 18 }, { label: "admin", value: 1 }],
    userBehavior: [{ label: "Views", value: 60 }, { label: "Reactions", value: 30 }, { label: "Comments", value: 12 }],
    contentStatus: [{ label: "published", value: 16 }, { label: "draft", value: 4 }],
    userGrowth: [{ label: "09-01", total: 2, fans: 1, creators: 1 }, { label: "09-02", total: 6, fans: 4, creators: 2 }],
    contentCreation: [{ label: "09-01", feedPosts: 2, seens: 1, worlds: 0, stories: 3 }, { label: "09-02", feedPosts: 4, seens: 2, worlds: 1, stories: 2 }],
    contentDistribution: [{ label: "SEEN", value: 5 }, { label: "WORLD", value: 3 }, { label: "Feed posts", value: 7 }],
    engagement: { trend: [{ label: "09-01", engagements: 12, messages: 3, reports: 1 }, { label: "09-02", engagements: 24, messages: 7, reports: 2 }] },
    topContent: { items: [{ title: "Launch note", creator: { username: "creator" }, type: "Feed post", views: 20, engagement: 35 }] },
    creatorPerformance: [{ creator: { username: "creator" }, content: 4, views: 20, followers: 8, engagement: 35 }],
    moderation: { totals: { byScope: { message: 2, seen: 1 } } },
    platformActivity: { hours: [{ label: "10:00", count: 4 }, { label: "11:00", count: 9 }] },
    supportedMetrics: { unavailable: ["true session retention"] },
  };
  const pdf = buildAnalyticsPdf(report);
  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
});
