import assert from "node:assert/strict";
import test from "node:test";
import Message from "./Message.js";
import MessageReport from "./MessageReport.js";
import UserBlock from "./UserBlock.js";

test("user blocks are unique by blocker and blocked account", () => {
  const index = UserBlock.schema.indexes().find(([fields]) => fields.blocker === 1 && fields.blocked === 1);
  assert.ok(index);
  assert.equal(index[1].unique, true);
});

test("message reports keep a private moderation snapshot", () => {
  const snapshot = MessageReport.schema.path("snapshot");
  assert.equal(snapshot.options.required, true);
  assert.equal(snapshot.options.select, false);
  assert.deepEqual(MessageReport.schema.path("scope").enumValues, ["MESSAGE", "CONVERSATION"]);
});

test("messages support private image metadata and soft deletion", () => {
  assert.ok(Message.schema.path("image.assetId"));
  assert.ok(Message.schema.path("image.width"));
  assert.equal(Message.schema.path("deletedAt").instance, "Date");
  assert.equal(Message.schema.path("deletedFor").instance, "Array");
});
