import assert from "node:assert/strict";
import test from "node:test";
import { serializeDiscoverSeen, selectSidebarSeens } from "./discoverController.js";

test("Fresh and Trending Seens deliver newly uploaded private videos with a signed URL", () => {
  const seen = serializeDiscoverSeen({
    _id: "seen-video", title: "Video Seen",
    coverMedia: { assetId: "onlyme/publications/creator/seen/root/cover/video", mediaType: "VIDEO", resourceType: "video", format: "mp4", secureUrl: "https://res.cloudinary.com/example/video/authenticated/unsigned.mp4" },
  });
  assert.equal(seen.coverMedia.mediaType, "VIDEO");
  assert.match(seen.coverMedia.secureUrl, /\/video\/authenticated\/s--[^/]+--\//);
  assert.equal(seen.cover, seen.coverMedia.secureUrl);
  assert.equal(seen.coverImage, seen.coverMedia.secureUrl);
});

test("Seen sidebar preserves external image covers and missing-cover fallback", () => {
  const image = { assetId: "demo-image", mediaType: "IMAGE", resourceType: "image", secureUrl: "https://example.test/cover.jpg" };
  const seen = serializeDiscoverSeen({ _id: "seen-image", coverMedia: image });
  assert.equal(seen.cover, image.secureUrl);
  assert.equal(seen.coverMedia.mediaType, "IMAGE");
  assert.equal(serializeDiscoverSeen({ _id: "no-cover" }).coverMedia, null);
});

test("sidebar selects trending by engagement and fresh by publication date without duplicate cards", () => {
  const items = [
    { id: "older", viewCount: 1, publishedAt: "2026-01-01" },
    { id: "trending", viewCount: 20, publishedAt: "2026-01-02" },
    { id: "fresh", viewCount: 2, publishedAt: "2026-01-04" },
    { id: "middle", viewCount: 3, publishedAt: "2026-01-03" },
  ];
  const result = selectSidebarSeens(items);
  assert.equal(result.trendingSeen.id, "trending");
  assert.deepEqual(result.freshSeens.map(item => item.id), ["fresh", "middle", "older"]);
  assert.equal(items[0].id, "older");
  assert.deepEqual(selectSidebarSeens([]), { trendingSeen: null, freshSeens: [] });
  assert.deepEqual(selectSidebarSeens([items[0]]).freshSeens, [items[0]]);
});
