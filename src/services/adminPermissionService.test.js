import test from "node:test";
import assert from "node:assert/strict";
import { ADMIN_PERMISSION_KEYS, DEFAULT_ADMIN_ROLE_PERMISSIONS, REQUIRED_ADMIN_ROLE_PERMISSIONS } from "../constants/adminPermissionConstants.js";
import { cleanAdminPermissions, permissionsWithRequired } from "./adminPermissionService.js";

test("admin permissions reject unknown values and remove duplicates", () => {
  assert.deepEqual(cleanAdminPermissions(["users.view", "unknown", "users.view", "finance.view"]), ["users.view", "finance.view"]);
});

test("main admin defaults retain every permission", () => {
  assert.deepEqual(DEFAULT_ADMIN_ROLE_PERMISSIONS.MAIN_ADMIN, ADMIN_PERMISSION_KEYS);
  assert.ok(DEFAULT_ADMIN_ROLE_PERMISSIONS.MODERATOR.includes("moderation.manage"));
  assert.ok(DEFAULT_ADMIN_ROLE_PERMISSIONS.FINANCE.includes("finance.manage"));
});

test("required operational permissions cannot be removed from saved role policies", () => {
  assert.deepEqual(permissionsWithRequired("MODERATOR", []), REQUIRED_ADMIN_ROLE_PERMISSIONS.MODERATOR);
  assert.deepEqual(permissionsWithRequired("FINANCE", ["analytics.view"]), [...REQUIRED_ADMIN_ROLE_PERMISSIONS.FINANCE, "analytics.view"]);
});
