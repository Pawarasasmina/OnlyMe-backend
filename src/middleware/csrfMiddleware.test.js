import test from "node:test";
import assert from "node:assert/strict";
import { csrfProtection } from "./csrfMiddleware.js";

function run({ method = "POST", cookies = { accessToken: "secret" }, headers = {} } = {}) {
  return new Promise((resolve) => {
    const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
    const req = { method, cookies, headers: normalized, get: (name) => normalized[name.toLowerCase()] };
    csrfProtection(req, {}, (error) => resolve(error || null));
  });
}

test("cookie-authenticated writes require a trusted origin and AJAX header", async () => {
  assert.equal((await run()).code, "CSRF_CHECK_FAILED");
  assert.equal((await run({ headers: { Origin: "https://attacker.example", "X-Requested-With": "XMLHttpRequest" } })).code, "CSRF_CHECK_FAILED");
  assert.equal(await run({ headers: { Origin: "http://localhost:5173", "X-Requested-With": "XMLHttpRequest" } }), null);
});

test("safe methods and bearer-authenticated service requests remain supported", async () => {
  assert.equal(await run({ method: "GET" }), null);
  assert.equal(await run({ headers: { Authorization: "Bearer service-token" } }), null);
});
