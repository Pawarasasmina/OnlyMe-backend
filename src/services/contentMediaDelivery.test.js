import assert from "node:assert/strict";
import test from "node:test";
import { authenticatedDeliveryUrl } from "./contentMediaStorageService.js";

test("authenticated media delivery URL is signed", () => {
  const url = authenticatedDeliveryUrl({ assetId: "onlyme/content/creator/content/example", resourceType: "image", mediaType: "IMAGE", format: "png" });
  assert.match(url, /^https:\/\/res\.cloudinary\.com\//);
  assert.match(url, /\/image\/authenticated\/s--[^/]+--\//);
  assert.match(url, /example\.png(?:\?|$)/);
});
