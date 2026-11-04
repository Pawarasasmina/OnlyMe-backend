import assert from "node:assert/strict";
import test from "node:test";
import MessageReport from "./MessageReport.js";
import ModerationAppeal from "./ModerationAppeal.js";
import AdminAuditEvent from "./AdminAuditEvent.js";
test("report schema supports every required source, category, target, and enforcement", () => { assert.ok(MessageReport.schema.path("source").enumValues.includes("UPLOAD_SCAN")); assert.ok(MessageReport.schema.path("source").enumValues.includes("DIRECT_ACCESS_DISPUTE")); for (const value of ["COMMENT", "CHAPTER", "DIRECT_ACCESS"]) assert.ok(MessageReport.schema.path("scope").enumValues.includes(value)); for (const value of ["DEFAMATION", "SELF_HARM", "CHILD_SAFETY", "IMPERSONATION"]) assert.ok(MessageReport.schema.path("reason").enumValues.includes(value)); for (const value of ["HIDDEN", "REMOVED", "POSTING_RESTRICTED", "SELLING_RESTRICTED", "SUSPENDED", "BANNED"]) assert.ok(MessageReport.schema.path("resolution.action").enumValues.includes(value)); });
test("appeals are unique per action and audit timestamps cannot be edited", () => { assert.ok(ModerationAppeal.schema.indexes().some(([fields, options]) => fields.reportModel === 1 && fields.reportId === 1 && options.unique)); assert.equal(AdminAuditEvent.schema.options.timestamps.updatedAt, false); });
