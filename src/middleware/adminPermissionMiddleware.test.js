import assert from "node:assert/strict";
import test from "node:test";
import { effectiveAdminRole, requireAdminRole } from "./adminPermissionMiddleware.js";

function run(user, ...roles) {
  return new Promise((resolve) => requireAdminRole(...roles)({ user }, {}, (error) => resolve(error || null)));
}

test("legacy administrators remain Main Admins", () => {
  assert.equal(effectiveAdminRole({ role: "admin" }), "MAIN_ADMIN");
});

test("admin roles enforce finance and moderation boundaries", async () => {
  assert.equal(await run({ role: "admin", adminRole: "FINANCE" }, "FINANCE", "MAIN_ADMIN"), null);
  assert.equal((await run({ role: "admin", adminRole: "FINANCE" }, "MODERATOR", "MAIN_ADMIN")).statusCode, 403);
  assert.equal((await run({ role: "admin", adminRole: "MODERATOR" }, "MAIN_ADMIN")).statusCode, 403);
  assert.equal(await run({ role: "admin" }, "MAIN_ADMIN"), null);
});

test("non-admin users never receive staff permissions", async () => {
  assert.equal(effectiveAdminRole({ role: "creator", adminRole: "MAIN_ADMIN" }), null);
  assert.equal((await run({ role: "creator", adminRole: "MAIN_ADMIN" }, "MAIN_ADMIN")).statusCode, 403);
});
