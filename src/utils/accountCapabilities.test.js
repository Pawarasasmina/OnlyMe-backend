import assert from "node:assert/strict";
import test from "node:test";
import { hasCreatorAccess, hasCreatorApplication, isConsumerAccount } from "./accountCapabilities.js";

test("unified fan accounts gain creator access from approval status", () => {
  const account = { role: "fan", creatorApprovalStatus: "approved" };
  assert.equal(isConsumerAccount(account), true);
  assert.equal(hasCreatorApplication(account), true);
  assert.equal(hasCreatorAccess(account), true);
});

test("pending and rejected applicants remain consumers without creator access", () => {
  for (const creatorApprovalStatus of ["pending", "rejected"]) {
    const account = { role: "fan", creatorApprovalStatus };
    assert.equal(hasCreatorApplication(account), true);
    assert.equal(hasCreatorAccess(account), false);
  }
});

test("Creator and Business profile types expose professional tools without changing financial account type", () => {
  assert.equal(hasCreatorAccess({ role: "fan", profileType: "creator", accountType: "SEED" }), true);
  assert.equal(hasCreatorAccess({ role: "fan", profileType: "business", accountType: "TEST" }), true);
  assert.equal(hasCreatorAccess({ role: "fan", profileAccountType: "creator", accountType: "REAL" }), true);
  assert.equal(hasCreatorAccess({ role: "fan", profileAccountType: "business", accountType: "REAL" }), true);
  assert.equal(hasCreatorAccess({ role: "fan", profileType: "personal", accountType: "REAL" }), false);
});

test("legacy creator records remain compatible until migration", () => {
  assert.equal(hasCreatorAccess({ role: "creator", creatorApprovalStatus: "approved" }), true);
  assert.equal(hasCreatorAccess({ role: "admin", creatorApprovalStatus: "approved" }), false);
});
