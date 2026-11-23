import test from "node:test";
import assert from "node:assert/strict";
import { ownsStoragePath } from "./storageBrand.js";

test("new and legacy assets retain exact ownership boundaries", () => {
  for (const root of ["atseen", "onlyme"]) {
    assert.equal(ownsStoragePath(`${root}/publications/creator/world/chapter/block/image`, "publications/creator/world/chapter/block"), true);
    assert.equal(ownsStoragePath(`${root}/content/creator/draft/image`, "content/creator/draft"), true);
    assert.equal(ownsStoragePath(`${root}/content/other/draft/image`, "content/creator/draft"), false);
    assert.equal(ownsStoragePath(`${root}/content/creator/draft-other/image`, "content/creator/draft"), false);
  }
  assert.equal(ownsStoragePath("other/content/creator/draft/image", "content/creator/draft"), false);
  assert.equal(ownsStoragePath(null, "publications"), false);
});
