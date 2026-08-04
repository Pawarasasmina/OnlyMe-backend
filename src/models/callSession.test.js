import test from "node:test";
import assert from "node:assert/strict";
import CallSession, { CALL_STATUSES } from "./CallSession.js";

test("call sessions persist a constrained WebRTC lifecycle", () => {
  assert.deepEqual(CALL_STATUSES, ["REQUESTED", "RINGING", "ACTIVE", "COMPLETED", "DECLINED", "MISSED", "CANCELED", "FAILED"]);
  assert.deepEqual(CallSession.schema.path("type").enumValues, ["AUDIO", "VIDEO"]);
  assert.equal(CallSession.schema.path("status").options.default, "RINGING");
  assert.equal(CallSession.schema.path("durationSeconds").options.min, 0);
  assert.equal(CallSession.schema.path("paid").options.default, false);
  assert.deepEqual(CallSession.schema.path("settlementStatus").enumValues, ["FREE", "HELD", "CAPTURED", "REFUND_PENDING", "REFUNDED"]);
  assert.ok(CallSession.schema.indexes().some(([fields]) => fields.caller === 1 && fields.createdAt === -1));
  assert.ok(CallSession.schema.indexes().some(([fields]) => fields.recipient === 1 && fields.createdAt === -1));
});
