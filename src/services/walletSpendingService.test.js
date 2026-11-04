import test from 'node:test';
import assert from 'node:assert/strict';
import { validSpendingLimit, spendingLimitExceeded, SPENDING_EVENTS } from './walletSpendingService.js';
test('monthly spending limit accepts zero as off and rejects invalid amounts', () => {
  for (const value of [0,25,50,100,250,500,1000]) assert.equal(validSpendingLimit(value),true);
  for (const value of [-1,1001,NaN,Infinity,'50',null,1.234]) assert.equal(validSpendingLimit(value),false);
});
test('limit allows exact boundary and blocks overspending, including concurrent accumulated amounts', () => {
  assert.equal(spendingLimitExceeded(50,40,10),false);
  assert.equal(spendingLimitExceeded(50,40,10.01),true);
  assert.equal(spendingLimitExceeded(0,1000,500),false);
  assert.equal(spendingLimitExceeded(25,30,1),true);
  assert.equal(spendingLimitExceeded(25,25,0.00001),true);
  assert.equal(SPENDING_EVENTS.includes('CREATOR_WITHDRAWAL_DEBIT'),false);
  assert.equal(SPENDING_EVENTS.includes('INCOME_CONVERSION_DEBIT'),false);
  assert.equal(SPENDING_EVENTS.includes('DA_HOLD_DEBIT'),true);
});
