import test from "node:test";
import assert from "node:assert/strict";
import { buildProfileStatusFromPayload, buildStatusFromPayload, serializeProfileStatus, serializeStatus } from "./statusService.js";

test("preset status builds with default expiry and toggles off when tapped again", () => {
  const now = new Date("2099-08-07T10:00:00.000Z");
  const { activeStatus, cleared } = buildStatusFromPayload({ presetKey: "at_seen" }, null, now);
  assert.equal(cleared, false);
  assert.equal(activeStatus.label, "At seen");
  assert.equal(activeStatus.emoji, "\uD83D\uDC41");
  assert.equal(activeStatus.color, "#9CCBFF");
  assert.equal(activeStatus.expiresAt.toISOString(), "2099-08-07T12:00:00.000Z");

  const toggled = buildStatusFromPayload({ presetKey: "at_seen" }, serializeStatus(activeStatus), now);
  assert.equal(toggled.cleared, true);
  assert.equal(toggled.activeStatus.isActive, false);
});

test("custom story status preserves plain text and expires inactive statuses", () => {
  const now = new Date("2099-08-07T10:00:00.000Z");
  const { activeStatus } = buildStatusFromPayload({
    emoji: "\u2615\uFE0Fextra",
    isCustom: true,
    label: " <script>Coffee break</script> ",
    presetKey: "custom",
  }, null, now);

  assert.equal(activeStatus.label, "<script>Coffee break</script>");
  assert.equal(activeStatus.presetKey, "custom");
  assert.equal(activeStatus.isCustom, true);
  assert.equal(serializeStatus({ ...activeStatus, expiresAt: new Date(Date.now() - 1000) }), null);
});

test("profile status persists without expiry and is trimmed before saving", () => {
  const now = new Date("2099-08-07T10:00:00.000Z");
  const { activeStatus, cleared } = buildProfileStatusFromPayload({ status: "  \uD83D\uDCD6 Writing a chapter  " }, now);
  assert.equal(cleared, false);
  assert.equal(activeStatus.label, "\uD83D\uDCD6 Writing a chapter");
  assert.equal(activeStatus.emoji, "\uD83D\uDCD6");
  assert.equal(activeStatus.expiresAt, null);
  assert.equal(activeStatus.isActive, true);
  assert.deepEqual(serializeProfileStatus(activeStatus), {
    color: "#9CCBFF",
    emoji: "\uD83D\uDCD6",
    isCustom: true,
    label: "\uD83D\uDCD6 Writing a chapter",
    presetKey: "custom",
    startedAt: now,
    updatedAt: now,
  });
});

test("profile status rejects whitespace, over-limit, and unsupported value types", () => {
  assert.throws(() => buildProfileStatusFromPayload({ status: "    " }), /Status text is required/);
  assert.throws(() => buildProfileStatusFromPayload({ status: "x".repeat(121) }), /120 characters or fewer/);
  assert.throws(() => buildProfileStatusFromPayload({ status: 42 }), /Status must be text/);
});

test("profile status clearing returns inactive status without touching other profile fields", () => {
  const { activeStatus, cleared } = buildProfileStatusFromPayload({ clear: true });
  assert.equal(cleared, true);
  assert.equal(activeStatus.isActive, false);
  assert.equal(activeStatus.label, "");
  assert.equal(serializeProfileStatus(activeStatus), null);
});

test("profile status preserves special characters, emoji, and unsafe html as plain text", () => {
  const { activeStatus } = buildProfileStatusFromPayload({ status: "\uD83D\uDCAC <b>Replying</b> & calls" });
  assert.equal(activeStatus.label, "\uD83D\uDCAC <b>Replying</b> & calls");
  assert.equal(activeStatus.emoji, "\uD83D\uDCAC");
  assert.equal(serializeProfileStatus(activeStatus).label, "\uD83D\uDCAC <b>Replying</b> & calls");
});
