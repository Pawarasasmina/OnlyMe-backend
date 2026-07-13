import assert from "node:assert/strict";
import test from "node:test";
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
