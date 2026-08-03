import test from "node:test";
import assert from "node:assert/strict";
import GroupConversation from "./GroupConversation.js";
import GroupMessage from "./GroupMessage.js";
import Conversation from "./Conversation.js";

test("group conversations persist membership, admins, and per-user preferences", () => {
  assert.ok(GroupConversation.schema.path("members"));
  assert.ok(GroupConversation.schema.path("admins"));
  assert.ok(GroupConversation.schema.path("archivedBy"));
  assert.ok(GroupConversation.schema.path("mutedBy"));
  assert.ok(GroupConversation.schema.indexes().some(([keys]) => keys.members === 1));
});

test("group messages persist replies, reactions, reads, and forwards", () => {
  assert.ok(GroupMessage.schema.path("group"));
  assert.ok(GroupMessage.schema.path("replyTo"));
  assert.ok(GroupMessage.schema.path("reactions"));
  assert.ok(GroupMessage.schema.path("deliveredBy"));
  assert.ok(GroupMessage.schema.path("readBy"));
  assert.ok(GroupMessage.schema.path("forwardedFrom"));
});

test("direct conversations support general participant pairs and per-user preferences", () => {
  assert.ok(Conversation.schema.path("participants"));
  assert.ok(Conversation.schema.path("participantKey"));
  assert.ok(Conversation.schema.path("requestRecipient"));
  assert.ok(Conversation.schema.path("archivedBy"));
  assert.ok(Conversation.schema.path("mutedBy"));
});
