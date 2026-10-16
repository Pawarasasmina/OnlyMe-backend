import test from "node:test";
import assert from "node:assert/strict";
import { serializePostSearchResult } from "../services/searchService.js";
import { getWallPost } from "./wallController.js";
import WallPost from "../models/WallPost.js";
import UserBlock from "../models/UserBlock.js";
const id = "507f1f77bcf86cd799439011";
const author = "507f1f77bcf86cd799439012";
const res = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test("search results link to the correct detail route for each post model", () => {
  const post = { _id: id, text: "Looking for a plumber", author: { _id: author, name: "Author" } };
  assert.equal(serializePostSearchResult(post, "plumber").route, `/posts/${id}`);
  assert.equal(serializePostSearchResult(post, "plumber", author, true).route, `/wall/notes/${id}`);
});

test("legacy Wall detail returns the selected published note", async (t) => {
  const post = { _id: id, creator: { _id: author, name: "Author" }, text: "A useful note", entityRefs: [], media: [], populate: async () => {} };
  let lookup;
  t.mock.method(WallPost, "findOne", async (filter) => { lookup = filter; return post; });
  t.mock.method(UserBlock, "exists", async () => null);
  const response = res();
  let error;
  await getWallPost({ params: { id }, user: { _id: author } }, response, (value) => { error = value; });
  assert.ifError(error);
  assert.deepEqual(lookup, { _id: id, status: "PUBLISHED" });
  assert.equal(String(response.body.data.post.id), id);
  assert.equal(response.body.data.post.text, "A useful note");
});

test("legacy detail does not expose blocked or unpublished notes", async (t) => {
  t.mock.method(WallPost, "findOne", async () => ({ _id: id, creator: author }));
  t.mock.method(UserBlock, "exists", async () => ({ _id: id }));
  let error;
  await getWallPost({ params: { id }, user: { _id: author } }, res(), (value) => { error = value; });
  assert.equal(error.statusCode, 404);
});
