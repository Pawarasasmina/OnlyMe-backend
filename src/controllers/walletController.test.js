import test from"node:test";import assert from"node:assert/strict";import{effectiveMembershipStatus,withdrawalBalances}from"./walletController.js";
import { withdrawCreatorIncome } from './walletController.js';
import { convertIncomeToCoins } from './walletController.js';

test("creator earnings cannot be converted into spendable coins", async () => {
  let failure;
  await convertIncomeToCoins({ body: {} }, {}, (error) => { failure = error; });
  assert.equal(failure.code, "INCOME_CONVERSION_DISABLED");
});
test("test earnings cannot request real payouts", async () => {
  let failure;
  await withdrawCreatorIncome({ body: {}, user: { accountType: "TEST" } }, {}, (error) => { failure = error; });
  assert.equal(failure.code, "TEST_PAYOUT_DISABLED");
});

test('unsupported instant payouts are rejected before any wallet mutation',async()=>{
  let failure;
  await withdrawCreatorIncome({body:{method:'instant'}},{},error=>{failure=error;});
  assert.equal(failure.code,'PAYOUT_METHOD_UNAVAILABLE');
});
test("Premium access reads become effectively expired after period end",()=>{const now=new Date("2026-07-17T00:00:00Z");assert.equal(effectiveMembershipStatus({status:"ACTIVE",currentPeriodEnd:"2026-07-16T00:00:00Z"},now),"EXPIRED");assert.equal(effectiveMembershipStatus({status:"CANCEL_AT_PERIOD_END",currentPeriodEnd:"2026-07-18T00:00:00Z"},now),"CANCEL_AT_PERIOD_END");assert.equal(effectiveMembershipStatus({status:"REFUNDED",currentPeriodEnd:"2026-07-18T00:00:00Z"},now),"REFUNDED")});
test("withdrawal balances hold recent income",()=>{assert.deepEqual(withdrawalBalances(1000,250),{pendingIncomeStars:250,availableIncomeStars:750});assert.deepEqual(withdrawalBalances(100,250),{pendingIncomeStars:100,availableIncomeStars:0});});
