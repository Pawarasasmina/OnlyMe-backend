import assert from "node:assert/strict";
import test from "node:test";
import { POST_REACTIONS } from "../constants/postConstants.js";
import FeedPost from "../models/FeedPost.js";
import { postControllerTestUtils, serializePost } from "./postController.js";

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

test("feed post media supports serialized voice-note metadata", () => {
  const mediaSchema = FeedPost.schema.path("media").schema;
  assert.ok(mediaSchema.path("type").enumValues.includes("audio"));
  assert.ok(mediaSchema.path("duration"));
  assert.ok(mediaSchema.path("transcript"));
  assert.equal(mediaSchema.path("transcriptLanguage").options.lowercase, undefined);
  assert.equal(mediaSchema.path("translations").schema.path("language").options.lowercase, undefined);
  assert.ok(mediaSchema.path("waveform"));

  const post = new FeedPost({
    author: "000000000000000000000001",
    text: "Voice note transcript",
    media: [{
      assetId: "onlyme/feed-posts/user/post/voice/sample",
      duration: 12.4,
      mimeType: "audio/webm",
      transcript: "Voice note transcript",
      type: "audio",
      url: "https://example.com/sample.webm",
      waveform: [0.2, 0.5, 0.3],
    }],
    status: "published",
  });

  const serialized = serializePost(post);
  assert.equal(serialized.media[0].type, "audio");
  assert.equal(serialized.media[0].duration, 12.4);
  assert.equal(serialized.media[0].mimeType, "audio/webm");
  assert.equal(serialized.media[0].transcript, "Voice note transcript");
  assert.deepEqual(serialized.media[0].waveform, [0.2, 0.5, 0.3]);
});

test("feed post voice translations display old short codes and new Lara locales", () => {
  const post = new FeedPost({
    author: "000000000000000000000001",
    text: "Voice note transcript",
    media: [{
      assetId: "onlyme/feed-posts/user/post/voice/sample",
      mimeType: "audio/webm",
      transcript: "Hello",
      translations: [
        { language: "fr", text: "Bonjour" },
        { language: "fr-FR", text: "Bonjour encore" },
      ],
      type: "audio",
      url: "https://example.com/sample.webm",
    }],
    status: "published",
  });

  const serialized = serializePost(post);
  assert.deepEqual(serialized.media[0].translations, [
    { language: "fr", languageName: "French", text: "Bonjour" },
    { language: "fr-FR", languageName: "French", text: "Bonjour encore" },
  ]);
});
