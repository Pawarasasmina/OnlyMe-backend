import test from "node:test";
import assert from "node:assert/strict";
import { buildStatusFromPayload, serializeStatus } from "./statusService.js";

test("preset status builds with default expiry and toggles off when tapped again", () => {
  const now = new Date("2099-08-07T10:00:00.000Z");
  const { activeStatus, cleared } = buildStatusFromPayload({ presetKey: "at_seen" }, null, now);
  assert.equal(cleared, false);
  assert.equal(activeStatus.label, "At seen");
  assert.equal(activeStatus.emoji, "👁");
  assert.equal(activeStatus.color, "#9CCBFF");
  assert.equal(activeStatus.expiresAt.toISOString(), "2099-08-07T12:00:00.000Z");

  const toggled = buildStatusFromPayload({ presetKey: "at_seen" }, serializeStatus(activeStatus), now);
  assert.equal(toggled.cleared, true);
  assert.equal(toggled.activeStatus.isActive, false);
});

test("custom status strips html and expires inactive statuses", () => {
  const now = new Date("2099-08-07T10:00:00.000Z");
  const { activeStatus } = buildStatusFromPayload({
    emoji: "☕️extra",
    isCustom: true,
    label: " <script>Coffee break</script> ",
    presetKey: "custom",
  }, null, now);

  assert.equal(activeStatus.label, "scriptCoffee break/script");
  assert.equal(activeStatus.presetKey, "custom");
  assert.equal(activeStatus.isCustom, true);
  assert.equal(serializeStatus({ ...activeStatus, expiresAt: new Date(Date.now() - 1000) }), null);
});
