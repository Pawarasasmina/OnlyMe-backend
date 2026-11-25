import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RECOMMENDATION_CONFIG, hasRealPhoto, rankCandidates, validateRecommendationConfig } from "./recommendationService.js";

test("recommendation defaults preserve the requested Seen 70/20/10 mix", () => {
  assert.deepEqual(DEFAULT_RECOMMENDATION_CONFIG.mixes.SEEN, { interest: 70, related: 20, discovery: 10 });
});

const viewerSignals = { creatorScores: new Map(), following: new Set(), topics: new Map(), relatedTopics: new Set(), location: { city: "Colombo", country: "Sri Lanka" }, languages: [], coldStart: true };
const candidate = (id, extra = {}) => ({ id, creator: { id: `owner-${id}`, avatar: "/uploads/portrait.jpg" }, publishedAt: new Date(), ...extra });

test("product rules upgrade old configs and normalize position bounds", () => {
  const old = validateRecommendationConfig({});
  assert.equal(old.productRules.newWorldPosition, 3);
  assert.equal(validateRecommendationConfig({ productRules: { newWorldPosition: 2.4, wallCityWeight: -1 } }).productRules.newWorldPosition, 2);
  assert.equal(validateRecommendationConfig({ productRules: { wallCityWeight: -1 } }).productRules.wallCityWeight, 0);
});

test("fresh World appears at position three; disabled, stale and exposed Worlds do not get placement", () => {
  const items = Array.from({ length: 6 }, (_, i) => candidate(`seen-${i}`));
  const world = candidate("world", { kind: "WORLD" });
  const config = validateRecommendationConfig({});
  const rank = (extra = {}, worlds = [world]) => rankCandidates([...items, ...worlds], { config, signals: viewerSignals, surface: "SEEN", ...extra });
  assert.equal(rank()[2].id, "world");
  assert.ok(rank()[2].recommendation.adjustments.some(rule => rule.rule === "new_world_position"));
  assert.ok(!rank({ exposureIds: new Set(["world"]) }).some(item => item.recommendation.adjustments.some(rule => rule.rule === "new_world_position")));
  assert.ok(!rank({}, [{ ...world, publishedAt: new Date("2020-01-01") }]).some(item => item.recommendation.adjustments.some(rule => rule.rule === "new_world_position")));
  config.productRules.newWorldPosition = 0;
  assert.ok(!rank().some(item => item.recommendation.adjustments.some(rule => rule.rule === "new_world_position")));
});

test("Wall city and country weights affect ranking and are explained", () => {
  const config = validateRecommendationConfig({});
  const items = [candidate("far", { location: "London, UK" }), candidate("country", { location: "Kandy, Sri Lanka" }), candidate("city", { location: "Colombo, Sri Lanka" })];
  const ranked = rankCandidates(items, { config, signals: viewerSignals, surface: "WALL" });
  assert.deepEqual(ranked.map(item => item.id), ["city", "country", "far"]);
  assert.deepEqual(ranked[0].recommendation.adjustments.map(rule => rule.rule), ["wall_country", "wall_city"]);
});

test("missing and generated avatars rank below uploaded portraits", () => {
  for (const value of ["", "https://api.dicebear.com/9.x/initials/svg", "/default-avatar.svg"]) assert.equal(hasRealPhoto(value), false);
  const items = [candidate("no-photo", { creator: { id: "missing" } }), candidate("portrait")];
  const rows = rankCandidates(items, { config: validateRecommendationConfig({}), signals: viewerSignals, surface: "DISCOVER" });
  assert.equal(rows[0].id, "portrait");
  assert.equal(rows[1].recommendation.adjustments[0].rule, "missing_photo");
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
