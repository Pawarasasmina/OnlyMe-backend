import test from "node:test";
import assert from "node:assert/strict";
import { validateRoleProfilePayload } from "./profileValidator.js";

test("translation preference supports Sinhala and preserves existing shorthand codes", () => {
  assert.equal(validateRoleProfilePayload("fan", { preferredLanguage: "si-LK" }, {}).profile.preferredLanguage, "si-LK");
  assert.equal(validateRoleProfilePayload("fan", { preferredLanguage: "en" }, {}).profile.preferredLanguage, "en");
});