import assert from "node:assert/strict";
import test from "node:test";
import DAWindow from "./DAWindow.js";
import Message from "./Message.js";
import CreatorProfile from "./CreatorProfile.js";
import { COMMAND_TYPES, LEDGER_ENTRY_TYPES } from "../constants/financialConstants.js";

test("Direct Access window separates lifecycle from settlement state", () => {
  const status = DAWindow.schema.path("status");
  const settlement = DAWindow.schema.path("settlementStatus");
  assert.deepEqual(status.enumValues, ["OPEN", "ANSWERED", "EXPIRED", "CLOSED"]);
  assert.deepEqual(settlement.enumValues, ["HELD", "CAPTURED", "REFUND_PENDING", "REFUNDED", "INCLUDED"]);
});

test("Direct Access enforces one sparse active key and expiry queries", () => {
  const indexes = DAWindow.schema.indexes();
  assert.ok(indexes.some(([fields, options]) => fields.activeWindowKey === 1 && options.unique && options.sparse));
  assert.ok(indexes.some(([fields]) => fields.status === 1 && fields.expiresAt === 1));
});

test("messages can be attributed to a Direct Access window", () => {
  assert.deepEqual(Message.schema.path("messageChannel").enumValues, ["STANDARD", "DIRECT_ACCESS"]);
  assert.ok(Message.schema.path("directAccessWindow"));
  assert.ok(Message.schema.indexes().some(([fields]) => fields.directAccessWindow === 1 && fields.createdAt === 1));
});

test("creator Direct Access settings and financial operation types exist", () => {
  assert.ok(CreatorProfile.schema.path("directAccessEnabled"));
  assert.equal(CreatorProfile.schema.path("directAccessPriceStars").options.default, 100);
  assert.equal(CreatorProfile.schema.path("directCallEnabled").options.default, false);
  assert.deepEqual(CreatorProfile.schema.path("directCallPriceStars").options.enum, [100, 300, 500, 800, 1500]);
  assert.deepEqual(CreatorProfile.schema.path("directCallDurationMinutes").options.enum, [2, 5, 10, 15, 20, 30]);
  for (const type of ["OPEN_DA_WINDOW", "CAPTURE_DA_WINDOW", "REFUND_DA_WINDOW"]) assert.ok(COMMAND_TYPES.includes(type));
  for (const type of ["DA_HOLD_DEBIT", "DA_CREATOR_EARNING", "DA_REFUND_CREDIT"]) assert.ok(LEDGER_ENTRY_TYPES.includes(type));
  for (const type of ["OPEN_PAID_CALL", "CAPTURE_PAID_CALL", "REFUND_PAID_CALL"]) assert.ok(COMMAND_TYPES.includes(type));
  for (const type of ["CALL_HOLD_DEBIT", "CALL_CREATOR_EARNING", "CALL_REFUND_CREDIT"]) assert.ok(LEDGER_ENTRY_TYPES.includes(type));
});
