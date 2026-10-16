import test from "node:test";
import assert from "node:assert/strict";
import FeedPost from "../models/FeedPost.js";
import UserBlock from "../models/UserBlock.js";
import CreatorProfile from "../models/CreatorProfile.js";
import FanProfile from "../models/FanProfile.js";
import { readWallTranslationContent } from "./wallTranslationController.js";
const id = "507f1f77bcf86cd799439011";
const viewer = "507f1f77bcf86cd799439012";
const owner = "507f1f77bcf86cd799439013";
const request = (extra = {}) => ({ params: { id }, query: {}, body: {}, user: { _id: viewer, role: "fan" }, ...extra });

test("translation uses stored content and saved viewer preference, ignoring supplied text or target", async (t) => {
  t.mock.method(FeedPost, "findOne", async () => ({ author: owner, visibility: "public", text: "Stored original", hiddenBy: [], media: [] }));
  t.mock.method(UserBlock, "exists", async () => null);
  t.mock.method(FanProfile, "findOne", () => ({ select: () => ({ lean: async () => ({ preferredLanguage: "ar" }) }) }));
  const result = await readWallTranslationContent(request({ body: { text: "Injected", targetLanguage: "ru" } }));
  assert.deepEqual(result, { text: "Stored original", preferredLanguage: "ar" });
});

test("voice translation reads the requested transcript and rejects other media IDs", async (t) => {
  t.mock.method(FeedPost, "findOne", async () => ({ author: owner, visibility: "public", text: "Caption", hiddenBy: [], media: [{ _id: "audio-id", type: "audio", transcript: "Voice original" }] }));
  t.mock.method(UserBlock, "exists", async () => null);
  t.mock.method(FanProfile, "findOne", () => ({ select: () => ({ lean: async () => ({ preferredLanguage: "en" }) }) }));
  const result = await readWallTranslationContent(request({ query: { mediaId: "audio-id" } }));
  assert.equal(result.text, "Voice original");
  await assert.rejects(readWallTranslationContent(request({ query: { mediaId: "other" } })), { statusCode: 404 });
});

test("unavailable, hidden, private, or blocked posts cannot be translated", async (t) => {
  let post = null;
  let blocked = false;
  t.mock.method(FeedPost, "findOne", async (filter) => { assert.equal(filter.status, "published"); assert.equal(filter.deletedAt, null); return post; });
  t.mock.method(UserBlock, "exists", async () => blocked);
  await assert.rejects(readWallTranslationContent(request()), { statusCode: 404 });
  post = { author: owner, visibility: "private", hiddenBy: [] };
  await assert.rejects(readWallTranslationContent(request()), { statusCode: 404 });
  post = { author: owner, visibility: "public", hiddenBy: [{ user: viewer }] };
  await assert.rejects(readWallTranslationContent(request()), { statusCode: 404 });
  post.hiddenBy = [];
  blocked = true;
  await assert.rejects(readWallTranslationContent(request()), { statusCode: 404 });
});


test("caption translation excludes the converted transcript displayed below audio", async (t) => {
  t.mock.method(FeedPost, "findOne", async () => ({ author: owner, visibility: "public", text: "My caption\n\nConverted speech", hiddenBy: [], media: [{ _id: "audio-id", type: "audio", transcript: "Converted speech" }] }));
  t.mock.method(UserBlock, "exists", async () => null);
  t.mock.method(FanProfile, "findOne", () => ({ select: () => ({ lean: async () => ({ preferredLanguage: "en" }) }) }));
  const result = await readWallTranslationContent(request());
  assert.equal(result.text, "My caption");
  const voice = await readWallTranslationContent(request({ query: { mediaId: "audio-id" } }));
  assert.equal(voice.text, "Converted speech");
});

 test("approved creator accounts use their creator translation preference", async (t) => {
  t.mock.method(FeedPost, "findOne", async () => ({ author: owner, visibility: "public", text: "Original", hiddenBy: [], media: [] }));
  t.mock.method(UserBlock, "exists", async () => null);
  t.mock.method(CreatorProfile, "findOne", () => ({ select: () => ({ lean: async () => ({ preferredLanguage: "si-LK" }) }) }));
  t.mock.method(FanProfile, "findOne", () => { throw new Error("Wrong profile"); });
  const result = await readWallTranslationContent(request({ user: { _id: viewer, role: "fan", creatorApprovalStatus: "approved" } }));
  assert.equal(result.preferredLanguage, "si-LK");
});
