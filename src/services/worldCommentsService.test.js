import assert from "node:assert/strict";
import test from "node:test";
import Publication from "../models/Publication.js";
import {
  INVALID_COMMENTS_SETTING_CODE,
  WORLD_COMMENTS_DISABLED_CODE,
  assertWorldCommentsEnabled,
  commentsEnabledForPublication,
  readCommentsEnabledSetting,
} from "./worldCommentsService.js";

test("World comments default to enabled for new and legacy publications", () => {
  const publication = new Publication({
    creator: "000000000000000000000001",
    kind: "PREMIUM_WORLD",
    pricing: { mode: "MONTHLY", starsAmount: 290 },
    previewPolicy: "ONE_CHAPTER",
  });

  assert.equal(Publication.schema.path("commentsEnabled").defaultValue, true);
  assert.equal(publication.commentsEnabled, true);
  assert.equal(commentsEnabledForPublication({}), true);
  assert.equal(commentsEnabledForPublication({ commentsEnabled: undefined }), true);
  assert.equal(commentsEnabledForPublication({ commentsEnabled: true }), true);
  assert.equal(commentsEnabledForPublication({ commentsEnabled: false }), false);
});

test("readCommentsEnabledSetting accepts only explicit Booleans", () => {
  assert.equal(readCommentsEnabledSetting({}), undefined);
  assert.equal(readCommentsEnabledSetting({ commentsEnabled: true }), true);
  assert.equal(readCommentsEnabledSetting({ commentsEnabled: false }), false);

  for (const value of ["true", "false", 0, 1, null, [], {}, "off"]) {
    assert.throws(
      () => readCommentsEnabledSetting({ commentsEnabled: value }),
      (error) => error.statusCode === 400 && error.code === INVALID_COMMENTS_SETTING_CODE
    );
  }
});

test("assertWorldCommentsEnabled blocks new comments with a stable API code", () => {
  assert.doesNotThrow(() => assertWorldCommentsEnabled({ commentsEnabled: true }));
  assert.doesNotThrow(() => assertWorldCommentsEnabled({}));
  assert.throws(
    () => assertWorldCommentsEnabled({ commentsEnabled: false }),
    (error) => error.statusCode === 403
      && error.code === WORLD_COMMENTS_DISABLED_CODE
      && error.message === "Comments are turned off for this World."
  );
});
