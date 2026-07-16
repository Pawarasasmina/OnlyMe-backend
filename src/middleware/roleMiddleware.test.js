import assert from "node:assert/strict";
import test from "node:test";
import { authorize } from "./roleMiddleware.js";

function runAuthorize(user, ...allowedRoles) {
  return new Promise((resolve) => {
    authorize(...allowedRoles)({ user }, {}, (error) => resolve(error || null));
  });
}

test("fan authorization allows fan users", async () => {
  const error = await runAuthorize({ role: "fan" }, "fan");

  assert.equal(error, null);
});

test("fan authorization rejects creator and admin users", async () => {
  const creatorError = await runAuthorize({ role: "creator" }, "fan");
  const adminError = await runAuthorize({ role: "admin" }, "fan");

  assert.equal(creatorError.statusCode, 403);
  assert.equal(adminError.statusCode, 403);
});
