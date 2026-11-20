import test from "node:test";
import assert from "node:assert/strict";
import User from "../models/User.js";
import PlatformSetting from "../models/PlatformSetting.js";
import CreatorVerification from "../models/CreatorVerification.js";
import PayoutBankApplication from "../models/PayoutBankApplication.js";
import Gift from "../models/Gift.js";
import GiftPreference from "../models/GiftPreference.js";
import GiftCategory from "../models/GiftCategory.js";
import CreatorProfile from "../models/CreatorProfile.js";
import { monetizationSummary, completeMonetizationEligibility, validateMonetizationPolicy } from "./monetizationService.js";

test("new creator can save eligibility before identity approval without bypassing earning checks", async t => {
  let user = { _id: "creator", profileAccountType: "creator", status: "active", dateOfBirth: new Date("1995-04-12"), monetization: {} };
  let verification = null, bank = null;
  let policy = { enabled: true, supportedCountries: [], termsVersion: "test-v1" };
  const query = value => ({ select() { return this; }, lean: async () => value });
  t.mock.method(PlatformSetting, "findOne", () => query({ value: policy }));
  t.mock.method(CreatorVerification, "findOne", () => query(verification));
  t.mock.method(PayoutBankApplication, "findOne", () => query(bank));
  t.mock.method(Gift, "find", () => query([{ _id: "gift" }]));
  t.mock.method(GiftPreference, "findOne", () => query(null));
  t.mock.method(GiftCategory, "distinct", async () => []);
  t.mock.method(CreatorProfile, "findOne", () => query({ directAccessEnabled: true }));
  t.mock.method(User, "findOneAndUpdate", async (_filter, update) => {
    for (const [key, value] of Object.entries(update.$set)) user.monetization[key.split(".")[1]] = value;
    return user;
  });
  const initial = await monetizationSummary(user);
  assert.equal(initial.hasDateOfBirth, true);
  assert.equal(initial.dateOfBirth, "1995-04-12");
  const saved = await completeMonetizationEligibility(user, { country: "AE", acceptTerms: true, termsVersion: "test-v1" });
  assert.equal(saved.eligibility.terms, true);
  assert.equal(saved.enabled, false);
  assert.equal(saved.country, "AE");
  verification = { status: "APPROVED", dateOfBirth: user.dateOfBirth, country: "AE" };
  assert.equal((await monetizationSummary(user)).enabled, false, "Empty country policy still requires approved bank country");
  bank = { status: "APPROVED", country: "United Arab Emirates" };
  const enabled = await monetizationSummary(user);
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.tools.gifts, true);
  assert.equal(enabled.tools.world, true);
  policy = { ...policy, supportedCountries: ["Sri Lanka"] };
  assert.equal((await monetizationSummary(user)).enabled, false, "Explicit country restrictions remain authoritative");
  await assert.rejects(completeMonetizationEligibility(user, { country: "Sri Lanka", acceptTerms: false, termsVersion: "test-v1" }), /Terms/);
});

test("admin call policy normalizes aliases and rejects unknown countries", () => {
  const base = { enabled: true, supportedCountries: [], termsVersion: "v1" };
  assert.deepEqual(validateMonetizationPolicy({ ...base, blockedCallCountries: ["UAE", "AE", "Sri Lanka"] }).blockedCallCountries, ["AE", "LK"]);
  assert.deepEqual(validateMonetizationPolicy({ ...base, blockedCallCountries: [] }).blockedCallCountries, []);
  assert.throws(() => validateMonetizationPolicy({ ...base, blockedCallCountries: ["Not a country"] }), /valid countries/);
});
