import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import User from "../models/User.js";
import IdentityVerification from "../models/IdentityVerification.js";
import { startIdentity, identityStatus, startBank, updateAutomaticPayout } from "./stripeIdentityService.js";
import { validStripeSignature, stripeConnectWebhook } from "../controllers/stripeIdentityWebhook.js";
import { payVerifiedCreator } from "./verifiedCreatorService.js";
import CreatorVerification from "../models/CreatorVerification.js";
import { countryCode, countriesMatch } from "../utils/countryCode.js";
let server;
const originalFetch = global.fetch, originalKey = process.env.STRIPE_SECRET_KEY;
before(async () => { server = await MongoMemoryServer.create(); await mongoose.connect(server.getUri()); await IdentityVerification.init(); process.env.STRIPE_SECRET_KEY = "sk_test_fixture"; });
after(async () => { global.fetch = originalFetch; if (originalKey) process.env.STRIPE_SECRET_KEY = originalKey; else delete process.env.STRIPE_SECRET_KEY; await mongoose.disconnect(); await server.stop(); });
test("provider result alone grants the seal; bank onboarding remains separate", async () => {
  const user = await User.create({ name: "Verification user", username: "verifyuser", email: "verify@example.test", password: "Password123", role: "fan" });
  let providerStatus = "requires_input";
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, body: new URLSearchParams(options.body) });
    let data;
    if (url.endsWith("account_links")) data = { url: "https://connect.stripe.com/setup/test" };
    else if (url.endsWith("accounts")) data = { id: "acct_test" };
    else if (url.includes("/accounts/")) data = { payouts_enabled: true, external_accounts: { data: [{ object: "bank_account", last4: "1234" }] } };
    else data = { id: "vs_test", status: providerStatus, url: "https://verify.stripe.com/test", metadata: { userId: String(user._id) } };
    return { ok: true, json: async () => data };
  };
  const session = await startIdentity(user);
  assert.equal(session.url, "https://verify.stripe.com/test");
  assert.equal(calls[0].body.get("options[document][require_matching_selfie]"), "true");
  assert.equal((await User.findById(user._id)).isVerified, false);
  await assert.rejects(startBank(user), /verification first/);
  providerStatus = "processing";
  assert.equal((await identityStatus(user)).status, "processing");
  assert.equal((await User.findById(user._id)).isVerified, false);
  providerStatus = "verified";
  assert.equal((await identityStatus(user)).status, "verified");
  assert.equal((await User.findById(user._id)).isVerified, true);
  assert.equal((await identityStatus(user)).bankReady, false);
  assert.match((await startBank(user)).url, /connect.stripe.com/);
  const status = await identityStatus(user);
  assert.equal(status.bankReady, true);
  assert.equal(status.bankLast4, "1234");
  assert.equal((await updateAutomaticPayout(user, false)).automaticPayout, false);
  await assert.rejects(updateAutomaticPayout(user, "true"), /setting/);
  await IdentityVerification.updateOne({ user: user._id }, { $set: { sealRevokedAt: new Date() } });
  await User.updateOne({ _id: user._id }, { $set: { isVerified: false } });
  await startIdentity(user);
  assert.equal((await User.findById(user._id)).isVerified, false, "reopening Stripe must not bypass an admin seal suspension");
  delete process.env.STRIPE_SECRET_KEY;
  assert.equal((await identityStatus(user)).available, false);
  await assert.rejects(startBank(user), /not configured/);
});
test("webhook requires signed, unmodified, recent bytes", () => {
  const body = Buffer.from('{"type":"identity.verification_session.verified"}');
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac("sha256", "secret").update(`${timestamp}.`).update(body).digest("hex");
  const header = `t=${timestamp},v1=${signature}`;
  assert.equal(validStripeSignature(body, header, "secret"), true);
  assert.equal(validStripeSignature(Buffer.from("tampered"), header, "secret"), false);
  assert.equal(validStripeSignature(body, header, "secret", Date.now() + 600000), false);
  assert.equal(validStripeSignature(body, header, "wrong"), false);
});
test("blue seals cannot be purchased through the retired payment endpoint", async () => {
  await assert.rejects(payVerifiedCreator(), /retired/);
});

test("admin-approved identity can onboard its own bank and only provider completion marks it ready", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
  const user = await User.create({ name: "Bank user", username: "bankuser", email: "bank@example.test", password: "Password123" });
  await CreatorVerification.collection.insertOne({ creator: user._id, purpose: "IDENTITY", status: "APPROVED", stateSyncPending: false, country: "UAE" });
  let ready = false, bankErrored = false, wrongOwner = false;
  let links = 0;
  const calls = [];
  global.fetch = async (url, options) => {
    const body = new URLSearchParams(options.body);
    calls.push({ url, body, key: options.headers["Idempotency-Key"] });
    const data = url.endsWith("account_links") ? { url: `https://connect.stripe.com/setup/${++links}` } : url.endsWith("accounts") ? { id: "acct_manual_bank" } : { metadata: { userId: wrongOwner ? "someone-else" : String(user._id) }, payouts_enabled: ready, requirements: { currently_due: ready ? [] : ["external_account"] }, external_accounts: { data: [{ object: "bank_account", last4: "6789", status: bankErrored ? "errored" : "verified" }] } };
    return { ok: true, json: async () => data };
  };
  const first = await startBank(user, "monetization");
  assert.equal(calls[0].body.get("country"), "AE");
  assert.equal(calls[0].key, `connect-${user._id}`);
  assert.match(calls[1].body.get("return_url"), /\/settings\/monetization\?verification=bank-return$/);
  assert.match(calls[1].body.get("refresh_url"), /verification=bank-refresh$/);
  assert.equal((await identityStatus(user)).bankReady, false);
  assert.equal((await identityStatus(user)).bankStatus, "requires_input");
  const second = await startBank(user, "monetization");
  assert.notEqual(first.url, second.url);
  assert.equal(calls.filter(call => call.url.endsWith("/accounts")).length, 1);
  assert.equal(calls.some(call => call.url.includes("verification_sessions")), false);
  ready = true;
  const completed = await identityStatus(user);
  assert.equal(completed.bankReady, true);
  assert.equal(completed.bankLast4, "6789");
  assert.equal(completed.bankStatus, "ready");
  bankErrored = true;
  assert.equal((await identityStatus(user)).bankReady, false);
  wrongOwner = true;
  await assert.rejects(identityStatus(user), /does not belong/);
  await assert.rejects(startBank(user, "https://evil.test"), /destination/);
});

test("country aliases resolve without assuming a payout country", () => {
  assert.equal(countryCode("United Arab Emirates"), "AE");
  assert.equal(countryCode("UAE"), "AE");
  assert.equal(countriesMatch("AE", "United Arab Emirates"), true);
  assert.equal(countryCode("Not a real country"), null);
});

test("Connect updates require a valid signature and recheck bank readiness with Stripe", async () => {
  const user = await User.create({ name: "Webhook user", username: "bankhook", email: "hook@example.test", password: "Password123" });
  await IdentityVerification.create({ user: user._id, status: "verified", connectAccountId: "acct_hook" });
  global.fetch = async () => ({ ok: true, json: async () => ({ metadata: { userId: String(user._id) }, payouts_enabled: true, external_accounts: { data: [{ object: "bank_account", status: "verified", last4: "4321" }] } }) });
  const savedSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = "test_connect_secret";
  try {
    const body = Buffer.from(JSON.stringify({ type: "account.updated", data: { object: { id: "acct_hook", payouts_enabled: false } } }));
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHmac("sha256", "test_connect_secret").update(`${timestamp}.`).update(body).digest("hex");
    const req = { body, headers: { "stripe-signature": "invalid" }, app: { get: () => null } };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await stripeConnectWebhook(req, res, error => { throw error; });
    assert.equal(res.statusCode, 400);
    assert.equal((await IdentityVerification.findOne({ user: user._id })).payoutsEnabled, false);
    req.headers["stripe-signature"] = `t=${timestamp},v1=${signature}`;
    await stripeConnectWebhook(req, res, error => { throw error; });
    const record = await IdentityVerification.findOne({ user: user._id });
    assert.equal(record.payoutsEnabled, true);
    assert.equal(record.bankLast4, "4321");
  } finally {
    if (savedSecret) process.env.STRIPE_CONNECT_WEBHOOK_SECRET = savedSecret;
    else delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  }
});
