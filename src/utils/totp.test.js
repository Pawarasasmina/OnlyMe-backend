import assert from "node:assert/strict";
import test from "node:test";
import { base32Decode, base32Encode, createTotpSecret, totp, verifyTotp } from "./totp.js";
test("TOTP secrets round-trip and verify within the allowed clock window", () => { const raw = Buffer.from("onlyme-admin-security"); assert.deepEqual(base32Decode(base32Encode(raw)), raw); const secret = createTotpSecret(); const at = 1_800_000_000_000; const code = totp(secret, at); assert.match(code, /^\d{6}$/); assert.equal(verifyTotp(secret, code, at), true); assert.equal(verifyTotp(secret, "000000", at), code === "000000"); });
