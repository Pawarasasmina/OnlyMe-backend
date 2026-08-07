import assert from "node:assert/strict";
import test from "node:test";
import { POST_REACTIONS } from "../constants/postConstants.js";
import FeedPost from "../models/FeedPost.js";
import { postControllerTestUtils } from "./postController.js";

const { feedFilterQuery } = postControllerTestUtils;

test("feed filter query maps Home chips to existing post contexts", () => {
  assert.deepEqual(feedFilterQuery({ filter: "all" }), {});
  assert.deepEqual(feedFilterQuery({ filter: "right_now" }), { context: "Right now" });
  assert.deepEqual(feedFilterQuery({ filter: "events" }), { context: "Events" });
  assert.deepEqual(feedFilterQuery({ filter: "things_to_do" }), { context: "Things to do" });
  assert.deepEqual(feedFilterQuery({ filter: "food" }), { context: { $in: ["Coffee", "Restaurant"] } });
});

test("feed filter query combines places with a safe location matcher", () => {
  assert.deepEqual(feedFilterQuery({ filter: "places", location: "Dubai." }), {
    location: { $ne: "", $regex: "Dubai\\.", $options: "i" },
  });
});

test("post reactions include the prototype reaction sheet options", () => {
  assert.deepEqual(
    ["like", "love", "fire", "clap", "laugh", "see_you", "sad", "phone", "strong", "pray"].every((reaction) => POST_REACTIONS.includes(reaction)),
    true
  );
});

test("feed posts persist unique view records and a view counter", () => {
  assert.ok(FeedPost.schema.path("views.user"));
  assert.ok(FeedPost.schema.path("viewCount"));
  assert.ok(FeedPost.schema.indexes().some(([keys]) => keys["views.user"] === 1 && keys.status === 1 && keys.publishedAt === -1));
});
