import test from "node:test";
import assert from "node:assert/strict";
import { normalizePhone, validateLoginPayload, validateRegisterPayload } from "./authValidator.js";

const registration = (identifier) => ({ firstName: "Maya", lastName: "Sen", name: "Maya Sen", username: "maya.sen", identifier, password: "password123", dateOfBirth: "1995-05-20" });

test("login accepts a username, email or phone identifier", () => {
  assert.equal(validateLoginPayload({ identifier: "maya.sen", password: "password123" }).identifier, "maya.sen");
  assert.equal(validateLoginPayload({ identifier: "Maya@Example.com", password: "password123" }).identifier, "Maya@Example.com");
  assert.equal(validateLoginPayload({ identifier: "+94 77 123 4567", password: "password123" }).identifier, "+94 77 123 4567");
});

test("registration stores either a normalized email or phone", () => {
  assert.deepEqual({ email: validateRegisterPayload(registration("Maya@Example.com")).email, phone: validateRegisterPayload(registration("Maya@Example.com")).phone }, { email: "maya@example.com", phone: "" });
  assert.deepEqual({ email: validateRegisterPayload(registration("+94 77 123 4567")).email, phone: validateRegisterPayload(registration("+94 77 123 4567")).phone }, { email: "", phone: "+94771234567" });
  assert.equal(normalizePhone("077-123-4567"), "0771234567");
});

test("registration rejects a malformed contact identifier", () => {
  assert.throws(() => validateRegisterPayload(registration("not-a-contact")), /valid phone number/i);
});

test("registration preserves the validated signup birthday", () => {
  assert.equal(validateRegisterPayload(registration("maya@example.com")).dateOfBirth.toISOString().slice(0, 10), "1995-05-20");
});
