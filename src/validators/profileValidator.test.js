import assert from "node:assert/strict";
import test from "node:test";
import { validateRoleProfilePayload, validateUsername } from "./profileValidator.js";

test("normalizes valid usernames", () => {
  assert.equal(validateUsername("@Creator.Name_01"), "creator.name_01");
});

test("rejects reserved usernames", () => {
  assert.throws(() => validateUsername("admin"), /reserved/);
});

test("rejects unsafe username formats", () => {
  assert.throws(() => validateUsername("bad handle"), /letters, numbers/);
});

test("allows and normalizes username changes for every profile role", () => {
  for (const role of ["fan", "creator", "admin"]) {
    const result = validateRoleProfilePayload(role, { username: "@Another.Name" }, { isVerified: false });
    assert.equal(result.common.username, "another.name");
  }
});

test("rejects creator-only NSFW toggle when user is not verified", () => {
  assert.throws(
    () =>
      validateRoleProfilePayload(
        "creator",
        {
          displayName: "Creator",
          nsfwEnabled: true,
        },
        { isVerified: false }
      ),
    /require verification/i
  );
});

test("validates creator subscription and PPM price ranges", () => {
  assert.throws(
    () =>
      validateRoleProfilePayload(
        "creator",
        {
          displayName: "Creator",
          subscriptionPriceCents: 100,
        },
        { isVerified: true }
      ),
    /Monthly subscription/
  );

  assert.throws(
    () =>
      validateRoleProfilePayload(
        "creator",
        {
          displayName: "Creator",
          ppmEnabled: true,
          ppmPrice: 5,
        },
        { isVerified: true }
      ),
    /Pay-per-message/
  );
});

test("keeps fan updates limited to fan profile fields", () => {
  const result = validateRoleProfilePayload(
    "fan",
    {
      displayName: "Fan User",
      bio: "Hello",
      subscriptionPriceCents: 99999,
      role: "admin",
    },
    { isVerified: false }
  );

  assert.equal(result.common.name, "Fan User");
  assert.equal(result.common.username, undefined);
  assert.equal(result.profile.bio, "Hello");
  assert.equal(result.profile.subscriptionPriceCents, undefined);
  assert.equal(result.profile.role, undefined);
});
