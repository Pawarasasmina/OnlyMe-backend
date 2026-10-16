import test from "node:test";
import assert from "node:assert/strict";
import { readWallFeedFilters, wallFeedPipeline } from "./wallFeedFilterService.js";

test("type and topic intersect and legacy fallback only applies to missing fields", () => {
  const { match } = readWallFeedFilters({ type: "looking_for", topic: "services", scope: "city", location: "Dubai", q: "plumber" });
  assert.equal(match.$and.length, 4);
  assert.equal(match.$and[0].$or[0].postType, "Looking for");
  assert.equal(match.$and[1].$or[0].topic, "Services");
  assert.deepEqual(match.$and[0].$or[1].$and[0], { $or: [{ postType: "" }, { postType: { $exists: false } }] });
});
test("location and search strings escape regex operators", () => {
  const { match } = readWallFeedFilters({ location: "Dubai.*", q: "(a+)+$" });
  assert.equal(match.$and[0].location.$regex, "Dubai\\.\\*");
  assert.equal(match.$and[1].text.$regex, "\\(a\\+\\)\\+\\$");
});
test("worldwide defaults do not filter posts", () => {
  assert.deepEqual(readWallFeedFilters({}), { match: {}, sort: "recent", near: "" });
});
test("unsupported options and Nearby without a city are rejected", () => {
  for (const query of [{ type: "bad" }, { type: "__proto__" }, { topic: "bad" }, { sort: "bad" }, { scope: "bad" }, { scope: "country" }, { sort: "nearby" }, { scope: "nearby" }]) {
    assert.throws(() => readWallFeedFilters(query), { statusCode: 400 });
  }
});
test("Nearby scope restricts the city, Nearby sort ranks city matches first", () => {
  const filters = readWallFeedFilters({ scope: "nearby", near: "Paris", sort: "nearby" });
  assert.equal(filters.match.$and[0].location.$regex, "Paris");
  const pipeline = wallFeedPipeline({}, filters, [], 2, 20);
  assert.equal(pipeline.find((stage) => stage.$sort).$sort.__nearby, 1);
  assert.deepEqual(pipeline.at(-1).$facet.items.slice(0, 2), [{ $skip: 20 }, { $limit: 20 }]);
});
test("popularity uses public activity and pagination counts original and shared entries together", () => {
  const pipeline = wallFeedPipeline({ status: "published" }, { sort: "popular", near: "" }, ["blocked"], 10, 20);
  assert.equal(pipeline.find((stage) => stage.$sort).$sort.__popularity, -1);
  assert.deepEqual(pipeline.at(-1).$facet.total, [{ $count: "count" }]);
  assert.equal(pipeline.at(-1).$facet.items[0].$skip, 180);
  const score = pipeline.find((stage) => stage.$set?.__popularity).$set.__popularity;
  assert.equal(score.$add.length, 3);
  assert.deepEqual(score.$add[0].$size.$filter.cond.$and[0], { $ne: ["$$entry.actorAccountType", "TEST"] });
});


test("every Wall sort keeps solved posts below active posts without excluding them", () => {
  for (const sort of ["recent", "popular", "nearby"]) {
    const pipeline = wallFeedPipeline({ status: "published" }, { sort, near: "Dubai" }, [], 1, 20);
    const order = pipeline.find((stage) => stage.$sort).$sort;
    assert.equal(Object.keys(order)[0], "__solved");
    assert.equal(order.__solved, 1);
    assert.equal(pipeline[0].$match.resolvedAt, undefined);
    const rank = pipeline.find((stage) => stage.$set?.__solved).$set.__solved;
    assert.deepEqual(rank.$cond[0].$ne[0], { $ifNull: ["$resolvedAt", null] });
    assert.equal(pipeline.find((stage) => stage.$project?.__solved).$project.__solved, 1);
  }
});
