import test from "node:test";
import assert from "node:assert/strict";
import ProtectedUsername from "./ProtectedUsername.js";
import User from "./User.js";
import UsernameReservation from "./UsernameReservation.js";
import { RESERVED_USERNAMES, validateUsername } from "../validators/profileValidator.js";

test("username protection schemas support managed names, verified handles, locks and 14-day reservations", () => {
  assert.deepEqual(ProtectedUsername.schema.path("kind").enumValues, ["PLATFORM", "BRAND", "VERIFIED_HANDLE"]);
  assert.ok(User.schema.path("usernameLocked"));
  assert.ok(User.schema.path("usernameChangeRequired"));
  assert.ok(UsernameReservation.schema.path("expiresAt").options.index);
  for (const name of ["seen", "atseen", "admin", "support"]) assert.ok(RESERVED_USERNAMES.has(name));
  assert.throws(() => validateUsername("Admin"), /reserved/);
  assert.equal(validateUsername("safe.creator"), "safe.creator");
});
