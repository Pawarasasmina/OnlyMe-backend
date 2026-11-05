import test from "node:test";
import assert from "node:assert/strict";
import { validateProfileAccountType } from "./profileAccountTypeValidator.js";
import { profileAccountType, profileCategory } from "../constants/profileCategoryConstants.js";
test("every type switch requires confirmation, category edits do not", () => {
  const user = { creatorApprovalStatus: "approved" };
  assert.throws(() => validateProfileAccountType(user, { profileAccountType: "personal" }), /Confirm/);
  assert.deepEqual(validateProfileAccountType(user, { profileAccountType: "personal", confirmSwitch: true }), { profileAccountType: "personal" });
  assert.equal(validateProfileAccountType(user, { profileAccountType: "creator", profileCategory: "Coach" }).profileCategory, "Coach");
});
test("category must match the selected type and cannot update verification or approval", () => {
  const user = { profileAccountType: "creator" };
  assert.throws(() => validateProfileAccountType(user, { profileAccountType: "business", profileCategory: "Coach", confirmSwitch: true }), /category/);
  assert.throws(() => validateProfileAccountType(user, { profileAccountType: "admin" }), /Choose/);
  assert.deepEqual(validateProfileAccountType(user, { profileAccountType: "business", profileCategory: "Shop", confirmSwitch: true, isVerified: true, creatorApprovalStatus: "approved" }), { profileAccountType: "business", profileCategory: "Shop" });
});
test("legacy creators retain their category; Personal hides it", () => {
  assert.equal(profileAccountType({ creatorApprovalStatus: "approved" }), "creator");
  assert.equal(profileCategory({ creatorApprovalStatus: "approved" }, { profileCategory: "Artist" }), "Artist");
  assert.equal(profileCategory({ profileAccountType: "personal", profileCategory: "Artist" }), "");
  assert.equal(profileCategory({ profileAccountType: "business", profileCategory: "Brand" }), "Brand");
});

test("Business contact choices are validated and empty selection stays explicitly configured", () => {
  const user = { profileAccountType: "creator" };
  const payload = { profileAccountType: "business", profileCategory: "Shop", confirmSwitch: true };
  for (const buttons of [["call", "directions", "website"], []]) {
    const updates = validateProfileAccountType(user, { ...payload, businessContactButtons: buttons });
    assert.deepEqual(updates.businessContactButtons, buttons);
    assert.equal(updates.businessContactButtonsConfigured, true);
  }
  for (const buttons of [["booking"], ["call", "call"], "call", null]) assert.throws(() => validateProfileAccountType(user, { ...payload, businessContactButtons: buttons }), /contact buttons/);
});
