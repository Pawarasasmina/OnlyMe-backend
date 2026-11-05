import assert from "node:assert/strict";
import test from "node:test";
import { requireAdminTwoFactor } from "./adminTwoFactorMiddleware.js";
const run = (user) => new Promise((resolve) => requireAdminTwoFactor({ user }, {}, (error) => resolve(error || null)));
test("admin console requires 2FA while consumer requests remain unaffected", async () => { assert.equal((await run({ role: "admin", adminTwoFactorEnabled: false })).code, "ADMIN_2FA_SETUP_REQUIRED"); assert.equal(await run({ role: "admin", adminTwoFactorEnabled: true }), null); assert.equal(await run({ role: "fan" }), null); });
