import assert from "node:assert/strict";
import test from "node:test";
import { reportAdminPath, reportTypeLabel } from "./moderationAlertService.js";

test("moderation alerts deep-link message reports to the message review workspace", () => {
  assert.equal(reportAdminPath({ _id: "report-1", scope: "MESSAGE" }, "MessageReport"), "/admin/message-reports/report-1");
  assert.equal(reportAdminPath({ _id: "report-2", scope: "CONVERSATION" }, "MessageReport"), "/admin/message-reports/report-2");
});

test("moderation alerts identify report types independently from categories", () => {
  assert.equal(reportTypeLabel({ scope: "PROFILE", reason: "COPYRIGHT" }, "MessageReport"), "USER PROFILE");
  assert.equal(reportTypeLabel({ scope: "SEEN", reason: "COPYRIGHT" }, "MessageReport"), "SEEN");
  assert.equal(reportTypeLabel({ kind: "PREMIUM_WORLD", reason: "SPAM" }, "PublicationReport"), "PREMIUM WORLD");
});

test("moderation alerts route profile and content reports to matching workspaces", () => {
  assert.equal(reportAdminPath({ _id: "profile-1", scope: "PROFILE_MEDIA" }, "MessageReport"), "/admin/user-reports/profile-1");
  assert.equal(reportAdminPath({ _id: "post-1", scope: "FEED_POST" }, "MessageReport"), "/admin/post-reports/post-1");
  assert.equal(reportAdminPath({ _id: "publication-1" }, "PublicationReport"), "/admin/safety?report=PublicationReport%3Apublication-1");
});
