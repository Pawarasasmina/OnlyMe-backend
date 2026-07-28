import assert from "node:assert/strict";
import test from "node:test";
import Message from "./Message.js";

test("messages keep a bounded client id for idempotent sends", () => {
  const path = Message.schema.path("clientMessageId");
  assert.equal(path.instance, "String");
  assert.equal(path.options.maxlength, 100);
});

test("message idempotency is unique per sender and ignores legacy rows", () => {
  const index = Message.schema.indexes().find(([fields]) => (
    fields.sender === 1 && fields.clientMessageId === 1
  ));

  assert.ok(index);
  assert.equal(index[1].unique, true);
  assert.deepEqual(index[1].partialFilterExpression, {
    clientMessageId: { $type: "string" },
  });
});

test("message history has indexes for both sides of a conversation", () => {
  const indexes = Message.schema.indexes().map(([fields]) => fields);
  assert.ok(indexes.some((fields) => fields.sender === 1 && fields.recipient === 1 && fields.createdAt === -1));
  assert.ok(indexes.some((fields) => fields.recipient === 1 && fields.readAt === 1 && fields.createdAt === -1));
});
