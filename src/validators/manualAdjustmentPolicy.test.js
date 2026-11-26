import assert from "node:assert/strict";
import test from "node:test";
import { assertManualAdjustmentAccess, assertManualAdjustmentTarget } from "./manualAdjustmentPolicy.js";
test("manual adjustments require Finance, non-production, enabled credits and a TEST target", () => {
  const settings = { nodeEnv: "development", enableAdminStarCredits: true };
  const user = { role: "admin", adminRole: "FINANCE" };
  for (const adminRole of ["MAIN_ADMIN", "MODERATOR", undefined]) assert.throws(() => assertManualAdjustmentAccess({ ...user, adminRole }, settings), { statusCode: 403 });
  assert.throws(() => assertManualAdjustmentAccess({ ...user, adminReadOnly: true }, settings), { statusCode: 403 });
  assert.throws(() => assertManualAdjustmentAccess(user, { ...settings, nodeEnv: "production" }), { statusCode: 403 });
  assert.throws(() => assertManualAdjustmentAccess(user, { ...settings, enableAdminStarCredits: false }), { statusCode: 403 });
  for (const accountType of ["REAL", "SEED", undefined]) assert.throws(() => assertManualAdjustmentTarget({ accountType }), { statusCode: 403 });
  assert.doesNotThrow(() => assertManualAdjustmentAccess(user, settings));
  assert.doesNotThrow(() => assertManualAdjustmentTarget({ accountType: "TEST" }));
});
