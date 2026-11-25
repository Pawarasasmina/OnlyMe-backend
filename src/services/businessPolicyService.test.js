import test from "node:test";
import assert from "node:assert/strict";
import { businessVerified, validateBusinessOffer } from "./businessPolicyService.js";
const offer = { text: "Studio session, all taxes included", price: 150, currency: "AED", offerRulesAccepted: true };
test("business verification expires and cannot be replaced by a pending or revoked application", () => {
  const now=new Date("2026-11-25");
  assert.equal(businessVerified({status:"APPROVED",expiresAt:"2027-01-01"},now),true);
  for(const status of ["PENDING","REJECTED","REVOKED","CHANGES_REQUESTED"]) assert.equal(businessVerified({status,expiresAt:"2027-01-01"},now),false);
  assert.equal(businessVerified({status:"APPROVED",expiresAt:"2026-01-01"},now),false);
});
test("business offers need a positive real price, currency and explicit truthful-claims confirmation",()=>{
  assert.doesNotThrow(()=>validateBusinessOffer(offer));
  for(const price of [null,0,-1,"free",1.5]) assert.throws(()=>validateBusinessOffer({...offer,price}),/real price/);
  assert.throws(()=>validateBusinessOffer({...offer,offerRulesAccepted:false}),/Confirm/);
  assert.throws(()=>validateBusinessOffer({...offer,text:"Guaranteed profit every day"}),/misleading/);
  assert.throws(()=>validateBusinessOffer({...offer,media:[{transcript:"Risk-free investment"}]}),/misleading/);
});
