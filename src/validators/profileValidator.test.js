import assert from "node:assert/strict";
import test from "node:test";
import { validateRoleProfilePayload, validateSettingsPayload, validateUsername, validateUsernameCandidate } from "./profileValidator.js";

test("normalizes valid usernames", () => {
  assert.equal(validateUsername("@Creator.Name_01"), "creator.name_01");
});

test("rejects reserved usernames", () => {
  assert.throws(() => validateUsername("admin"), /reserved/);
});

test("rejects unsafe username formats", () => {
  assert.throws(() => validateUsername("bad handle"), /letters, numbers/);
  assert.throws(() => validateUsername(".bad"), /start or end/);
  assert.throws(() => validateUsername("ba..d"), /repeated/);
  assert.throws(() => validateUsername("ab"), /at least 3/);
});

test("allows safe username changes through the profile allowlist", () => {
  const result = validateRoleProfilePayload(
    "fan",
    { username: "Another_Name" },
    { username: "current_name", isVerified: false }
  );

  assert.equal(result.common.username, "another_name");
});

test("reports username candidate reasons", () => {
  assert.deepEqual(validateUsernameCandidate("admin"), {
    username: "admin",
    valid: false,
    reason: "reserved",
    message: "That username is reserved",
  });
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

test("validates dedicated settings payloads by role", () => {
  const privacy = validateSettingsPayload("creator", "privacy", {
    profileVisibility: "public",
    allowDiscovery: false,
    systemAccessLevel: "owner",
  });

  assert.equal(privacy.profileVisibility, "public");
  assert.equal(privacy.privacySettings.allowDiscovery, false);
  assert.equal(privacy.privacySettings.systemAccessLevel, undefined);

  assert.throws(
    () => validateSettingsPayload("admin", "notifications", { notificationPreferences: { security: false } }),
    /cannot be disabled/
  );
});
