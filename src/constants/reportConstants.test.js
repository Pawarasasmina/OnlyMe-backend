import assert from "node:assert/strict";
import test from "node:test";
import { normalizeReportReason, REPORT_REASON_SET, URGENT_REPORT_REASONS } from "./reportConstants.js";

test("all reporting surfaces share normalized canonical categories", () => {
  assert.equal(normalizeReportReason("child safety"), "CHILD_SAFETY");
  assert.equal(normalizeReportReason("Self-harm"), "SELF_HARM");
  assert.equal(normalizeReportReason("copyright"), "COPYRIGHT");
  assert.equal(normalizeReportReason("unknown category", ""), null);
  assert.equal(REPORT_REASON_SET.has("IMPERSONATION"), true);
  assert.equal(URGENT_REPORT_REASONS.has("CHILD_SAFETY"), true);
});
