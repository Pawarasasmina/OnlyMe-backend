import assert from "node:assert/strict";
import test from "node:test";
import {
  validateLoginPayload,
  validateRegisterPayload,
  validateResetPasswordPayload,
} from "./authValidator.js";

test("registration normalizes email and accepts a valid fan account", () => {
  const payload = validateRegisterPayload({
    name: "Mina Ray",
    username: "Mina.Ray",
    email: "  MINA@example.COM ",
    password: "Strong123",
    confirmPassword: "Strong123",
    role: "fan",
    termsAccepted: true,
  });

  assert.equal(payload.email, "mina@example.com");
  assert.equal(payload.username, "mina.ray");
  assert.equal(payload.role, "fan");
});

test("registration rejects admin self-registration", () => {
  assert.throws(
    () => validateRegisterPayload({
      name: "Admin",
      username: "admin.user",
      email: "admin@example.com",
      password: "Strong123",
      confirmPassword: "Strong123",
      role: "admin",
      termsAccepted: true,
    }),
    /valid account type/
  );
});

test("registration rejects invalid email, weak password, mismatch, and missing terms", () => {
  assert.throws(
    () => validateRegisterPayload({
      name: "Mina Ray",
      username: "mina",
      email: "not-email",
      password: "password",
      confirmPassword: "different",
      role: "fan",
      termsAccepted: false,
    }),
    /valid email/
  );

  assert.throws(
    () => validateRegisterPayload({
      name: "Mina Ray",
      username: "mina",
      email: "mina@example.com",
      password: "password",
      confirmPassword: "password",
      role: "fan",
      termsAccepted: true,
    }),
    /uppercase, lowercase, and number/
  );

  assert.throws(
    () => validateRegisterPayload({
      name: "Mina Ray",
      username: "mina",
      email: "mina@example.com",
      password: "Strong123",
      confirmPassword: "Strong124",
      role: "fan",
      termsAccepted: true,
    }),
    /Passwords do not match/
  );

  assert.throws(
    () => validateRegisterPayload({
      name: "Mina Ray",
      username: "mina",
      email: "mina@example.com",
      password: "Strong123",
      confirmPassword: "Strong123",
      role: "fan",
      termsAccepted: false,
    }),
    /terms/
  );
});

test("login normalizes email and rejects missing password", () => {
  const payload = validateLoginPayload({ email: " FAN@Example.com ", password: "Strong123" });
  assert.equal(payload.email, "fan@example.com");
  assert.equal(payload.password, "Strong123");

  assert.throws(() => validateLoginPayload({ email: "fan@example.com" }), /password/);
});

test("reset password validation enforces token, policy, and matching confirmation", () => {
  assert.throws(
    () => validateResetPasswordPayload({ newPassword: "Strong123", confirmPassword: "Strong123" }),
    /token/
  );

  assert.throws(
    () => validateResetPasswordPayload({ token: "abc", newPassword: "weakpass", confirmPassword: "weakpass" }),
    /uppercase, lowercase, and number/
  );

  assert.throws(
    () => validateResetPasswordPayload({ token: "abc", newPassword: "Strong123", confirmPassword: "Strong124" }),
    /Passwords do not match/
  );
});
