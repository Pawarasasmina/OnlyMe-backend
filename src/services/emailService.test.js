import test from "node:test";
import assert from "node:assert/strict";
import { welcomeEmail } from "./emailService.js";

test("welcome email is branded and role-aware for fans", () => {
  const email = welcomeEmail({ name: "Pawara Sasmina", role: "fan" });
  assert.match(email.subject, /Welcome to @seen/);
  assert.match(email.text, /Start discovering/);
  assert.match(email.html, /We see you, Pawara/);
});

test("welcome email uses the same registration message regardless of later creator access", () => {
  const email = welcomeEmail({ name: "Lina", role: "creator" });
  assert.match(email.text, /Start discovering/);
  assert.match(email.html, /Your space is ready/);
});

test("welcome email escapes user-provided names", () => {
  const email = welcomeEmail({ name: "<script>alert(1)</script>", role: "fan" });
  assert.doesNotMatch(email.html, /<script>/);
  assert.match(email.html, /&lt;script&gt;/);
});
