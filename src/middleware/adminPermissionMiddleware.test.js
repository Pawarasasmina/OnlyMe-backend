import assert from "node:assert/strict";
import test from "node:test";
import { effectiveAdminRole, requireAdminRole, requireIdentityReviewAccess } from "./adminPermissionMiddleware.js";

test("identity review excludes finance, all read-only accounts, and non-admins", () => {
  for (const role of ["MAIN_ADMIN", "MODERATOR", "FINANCE"]) {
    for (const adminReadOnly of [true, false]) {
      let result;
      const req = { user: { role: "admin", adminRole: role, adminReadOnly } };
      requireIdentityReviewAccess(req, {}, (error) => { result = error; });
      if (adminReadOnly || role === "FINANCE") assert.equal(result.statusCode, 403);
      else { assert.equal(result, undefined); assert.equal(req.adminRole, role); }
    }
  }
  requireIdentityReviewAccess({ user: { role: "fan", adminRole: "MAIN_ADMIN" } }, {}, (error) => assert.equal(error.statusCode, 403));
});

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
