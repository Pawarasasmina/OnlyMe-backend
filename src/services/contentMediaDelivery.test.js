import assert from "node:assert/strict";
import test from "node:test";
import { authenticatedDeliveryUrl } from "./contentMediaStorageService.js";

test("authenticated media delivery URL is signed", () => {
  const url = authenticatedDeliveryUrl({ assetId: "onlyme/content/creator/content/example", resourceType: "image", mediaType: "IMAGE", format: "png" });
  assert.match(url, /^https:\/\/res\.cloudinary\.com\//);
  assert.match(url, /\/image\/authenticated\/s--[^/]+--\//);
  assert.match(url, /example\.png(?:\?|$)/);
});

test("external seed and legacy media URLs are preserved", () => {
  const secureUrl = "https://images.unsplash.com/photo-1512820790803-83ca734da794";
  const url = authenticatedDeliveryUrl({
    assetId: "orbit-seed-anna-books-that-rebuilt-me",
    resourceType: "image",
    mediaType: "IMAGE",
    secureUrl,
    format: "jpg",
  });

  assert.equal(url, secureUrl);
});
