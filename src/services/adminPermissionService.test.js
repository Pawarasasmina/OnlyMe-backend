import test from "node:test";
import assert from "node:assert/strict";
import { ADMIN_PERMISSION_KEYS, DEFAULT_ADMIN_ROLE_PERMISSIONS } from "../constants/adminPermissionConstants.js";
import { cleanAdminPermissions } from "./adminPermissionService.js";

test("admin permissions reject unknown values and remove duplicates", () => {
  assert.deepEqual(cleanAdminPermissions(["users.view", "unknown", "users.view", "finance.view"]), ["users.view", "finance.view"]);
});

test("main admin defaults retain every permission", () => {
  assert.deepEqual(DEFAULT_ADMIN_ROLE_PERMISSIONS.MAIN_ADMIN, ADMIN_PERMISSION_KEYS);
  assert.ok(DEFAULT_ADMIN_ROLE_PERMISSIONS.MODERATOR.includes("moderation.manage"));
  assert.ok(DEFAULT_ADMIN_ROLE_PERMISSIONS.FINANCE.includes("finance.manage"));
});
