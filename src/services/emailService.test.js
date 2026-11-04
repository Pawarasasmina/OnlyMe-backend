import test from "node:test";
import assert from "node:assert/strict";
import { welcomeEmail, worldCancellationEmail, worldRenewalReminderEmail } from "./emailService.js";

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

test("World cancellation email states the real access end and no further charge", () => {
  const email = worldCancellationEmail({ currentPeriodEnd: "2026-12-15T00:00:00.000Z", memberName: "Maya", worldTitle: "Morning Discipline" });
  assert.match(email.subject, /Morning Discipline membership ends 15 December 2026/);
  assert.match(email.text, /keep using Morning Discipline until 15 December 2026/);
  assert.match(email.text, /will not be charged again/);
  assert.match(email.text, /member number is held for 30 days/);
  assert.match(email.html, /Manage memberships/);
});

test("World renewal reminder states price, date, and management choices", () => {
  const email = worldRenewalReminderEmail({ currentPeriodEnd: "2026-12-15T00:00:00.000Z", memberName: "Maya", stars: 490, worldTitle: "Morning Discipline" });
  assert.equal(email.subject, "Morning Discipline renews in 3 days");
  assert.match(email.text, /490 coins on 15 December 2026/);
  assert.match(email.text, /top up, manage, or cancel anytime/i);
});
