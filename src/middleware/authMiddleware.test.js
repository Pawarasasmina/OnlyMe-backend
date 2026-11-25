import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { env } from "../config/env.js";
import { optionalProtect } from "./authMiddleware.js";
import { protect } from "./authMiddleware.js";

function runProtect(req) {
  return new Promise((resolve) => {
    protect(req, {}, (error) => resolve(error || null));
  });
}

test("protect returns a 401 error for invalid tokens", async () => {
  const error = await runProtect({
    headers: {
      authorization: "Bearer invalid-token",
    },
  });

  assert.equal(error.statusCode, 401);
  assert.equal(error.message, "Invalid or expired authentication token");
});

for (const middleware of [protect, optionalProtect]) {
  test(`${middleware === protect ? "protected" : "optional"} authentication blocks an existing minor session`, async () => {
    const original = User.findById;
    User.findById = () => ({ select: async () => ({ _id: "minor", status: "active", authVersion: 0, dateOfBirth: "2020-01-01" }) });
    try {
      const token = jwt.sign({ sub: "minor" }, env.accessSecret);
      const error = await new Promise(resolve => middleware({ headers: { authorization: `Bearer ${token}` } }, {}, error => resolve(error)));
      assert.equal(error.statusCode, 403);
      assert.equal(error.code, "MINIMUM_AGE_REQUIRED");
    } finally { User.findById = original; }
  });
}
