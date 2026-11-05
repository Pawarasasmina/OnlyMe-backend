import test from "node:test";
import assert from "node:assert/strict";
import CreatorProfile from "../models/CreatorProfile.js";
import FanProfile from "../models/FanProfile.js";
import { getMyAccountSettings, updateMyAccountSettings } from "./profileController.js";

const response = () => ({ status() { return this; }, json(body) { this.body = body; return this; } });
const fail = error => { throw error; };

test("Creator with fan login role saves English to the profile read after refresh", async t => {
  const stored = { preferredLanguage: "ru", uiLanguageSelectedAt: null };
  const user = { _id: "000000000000000000000001", role: "fan", creatorApprovalStatus: "approved" };
  t.mock.method(FanProfile, "updateOne", () => { throw new Error("Wrong language profile"); });
  t.mock.method(CreatorProfile, "updateOne", async (_filter, update) => { Object.assign(stored, update.$set); });
  t.mock.method(CreatorProfile, "findOneAndUpdate", async () => stored);
  const before = response();
  await getMyAccountSettings({ user }, before, fail);
  assert.equal(before.body.data.preferences.preferredLanguageExplicit, false);
  const saved = response();
  await updateMyAccountSettings({ user, body: { preferredLanguage: "en" } }, saved, fail);
  assert.equal(saved.body.data.preferences.preferredLanguage, "en");
  assert.equal(saved.body.data.preferences.preferredLanguageExplicit, true);
  assert.ok(stored.uiLanguageSelectedAt instanceof Date);
  const refreshed = response();
  await getMyAccountSettings({ user }, refreshed, fail);
  assert.equal(refreshed.body.data.preferences.preferredLanguage, "en");
  assert.equal(refreshed.body.data.preferences.preferredLanguageExplicit, true);
});

test("a genuinely selected non-English language remains an explicit preference", async t => {
  t.mock.method(FanProfile, "findOneAndUpdate", async () => ({ preferredLanguage: "fr", uiLanguageSelectedAt: new Date() }));
  const res = response();
  await getMyAccountSettings({ user: { _id: "000000000000000000000002", role: "fan" } }, res, fail);
  assert.equal(res.body.data.preferences.preferredLanguage, "fr");
  assert.equal(res.body.data.preferences.preferredLanguageExplicit, true);
});
