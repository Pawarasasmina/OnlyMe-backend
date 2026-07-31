import assert from "node:assert/strict"; import test from "node:test";
import { assertContentComplete, normalizeContentPayload } from "./contentValidator.js";
const image = { assetId: "a", resourceType: "image", mediaType: "IMAGE", secureUrl: "hidden", format: "jpg", isPrimary: true };
const base = { title: "Post", description: "", body: "", category: "art", tags: [], accessLevel: "PUBLIC", coinPrice: null };
test("validates image, video, audio and text completion rules", () => {
  assert.doesNotThrow(() => assertContentComplete({ ...base, contentType: "IMAGE", media: [image] }));
  assert.doesNotThrow(() => assertContentComplete({ ...base, contentType: "VIDEO", media: [{ ...image, resourceType: "video", mediaType: "VIDEO", format: "mp4" }] }));
  assert.doesNotThrow(() => assertContentComplete({ ...base, contentType: "AUDIO", media: [{ ...image, resourceType: "video", mediaType: "AUDIO", format: "mp3" }] }));
  assert.doesNotThrow(() => assertContentComplete({ ...base, contentType: "TEXT", body: "Hello", media: [] }));
  assert.throws(() => assertContentComplete({ ...base, contentType: "TEXT", media: [] }), /Body is required/);
});
test("normalizes tags and enforces pay-per-view pricing", () => {
  const result = normalizeContentPayload({ ...base, contentType: "TEXT", body: "x", tags: [" New Tag ", "new tag"], accessLevel: "PAY_PER_VIEW", coinPrice: 20 });
  assert.deepEqual(result.tags, ["new tag"]); assert.equal(result.coinPrice, 20);
  assert.throws(() => normalizeContentPayload({ ...base, contentType: "TEXT", accessLevel: "PAY_PER_VIEW", coinPrice: 1.5 }), /positive integer/);
  assert.throws(() => normalizeContentPayload({ ...base, contentType: "TEXT", status: "PUBLISHED" }), /cannot be changed/);
});
