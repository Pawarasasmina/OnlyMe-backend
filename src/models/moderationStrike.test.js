import assert from "node:assert/strict";
import test from "node:test";
import ModerationStrike from "./ModerationStrike.js";
import PayoutHold from "./PayoutHold.js";
import MessageReport from "./MessageReport.js";

test("moderation strikes retain case identity, consequence and appeal reversal data", () => {
  for (const field of ["user", "reportModel", "reportId", "category", "resolutionAction", "strikeNumberAtIssue", "automaticConsequence", "active", "reversedAt", "reversalReason"]) assert.ok(ModerationStrike.schema.path(field), field);
  assert.deepEqual(ModerationStrike.schema.path("automaticConsequence").enumValues, ["WARNING", "POSTING_RESTRICTED_7_DAYS", "BANNED"]);
  assert.ok(ModerationStrike.schema.indexes().some(([fields, options]) => fields.reportModel === 1 && fields.reportId === 1 && options.unique));
});

test("payout holds distinguish manual finance holds from open serious cases", () => {
  assert.ok(PayoutHold.schema.path("manualActive"));
  assert.ok(PayoutHold.schema.path("seriousCaseRefs"));
  assert.notEqual(PayoutHold.schema.path("placedBy").options.required, true);
});

test("resolved reports store the automatic strike result", () => {
  for (const field of ["resolution.strike", "resolution.strikeNumber", "resolution.automaticConsequence"]) assert.ok(MessageReport.schema.path(field), field);
});
