import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RECOMMENDATION_CONFIG, rankCandidates, validateRecommendationConfig } from "./recommendationService.js";

test("recommendation defaults preserve the requested Seen 70/20/10 mix", () => {
  assert.deepEqual(DEFAULT_RECOMMENDATION_CONFIG.mixes.SEEN, { interest: 70, related: 20, discovery: 10 });
});

test("recommendation configuration rejects mixes that do not total 100", () => {
  assert.throws(() => validateRecommendationConfig({ mixes: { SEEN: { interest: 70, related: 20, discovery: 9 } } }), /total 100/);
});

test("ranking separates interests, related creators, and discovery", () => {
  const signals = { creatorScores: new Map([["creator-2", 10]]), following: new Set(["creator-2"]), topics: new Map([["travel", 12]]), location: {}, languages: [], coldStart: false };
  const rows = rankCandidates([
    { _id: "interest", category: "travel", creator: "creator-1", publishedAt: new Date() },
    { _id: "related", category: "food", creator: "creator-2", publishedAt: new Date() },
    { _id: "discovery", category: "art", creator: "creator-3", publishedAt: new Date() },
  ], { config: { ...DEFAULT_RECOMMENDATION_CONFIG, rules: { ...DEFAULT_RECOMMENDATION_CONFIG.rules, batchSize: 10 } }, exposureIds: new Set(), signals, surface: "SEEN" });
  assert.deepEqual(Object.fromEntries(rows.map((row) => [row._id, row.recommendation.bucket])), { interest: "interest", related: "related", discovery: "discovery" });
});

test("uncategorized story groups are not limited to two recommendations", () => {
  const items = Array.from({ length: 8 }, (_, index) => ({ user: { id: `person-${index}` }, stories: [{ id: `story-${index}` }] }));
  const rows = rankCandidates(items, {
    config: { ...DEFAULT_RECOMMENDATION_CONFIG, rules: { ...DEFAULT_RECOMMENDATION_CONFIG.rules, batchSize: 8 } },
    exposureIds: new Set(),
    signals: { creatorScores: new Map(), following: new Set(), topics: new Map(), relatedTopics: new Set(), location: {}, languages: [], coldStart: true },
    surface: "STORIES",
  });
  assert.equal(rows.length, 8);
});
