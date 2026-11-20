import test from "node:test";
import assert from "node:assert/strict";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import { findConversationState, giftConversationState } from "./giftConversationService.js";
const pair = { participantKey: "fan:creator", fan: "fan", creator: "creator", participants: ["fan", "creator"] };
for (const status of [null, "ACTIVE", "REQUEST"]) test(`gift preserves ${status || "absent"} conversation without creating a request or granting acceptance`, async t => {
  const conversation = status ? { status, acceptedByCreator: false } : null;
  t.mock.method(Conversation, "findOne", async () => conversation);
  const write = t.mock.method(Conversation, "findOneAndUpdate", async () => { throw new Error("Unexpected conversation write"); });
  const messages = t.mock.method(Message, "exists", async () => { throw new Error("Unexpected message consent lookup"); });
  assert.equal(await giftConversationState(pair), conversation);
  assert.equal(write.mock.callCount(), 0);
  assert.equal(messages.mock.callCount(), 0);
  if (conversation) assert.equal(conversation.status, status);
});
test("gift does not reopen a declined request", async t => {
  t.mock.method(Conversation, "findOne", async () => ({ status: "DECLINED" }));
  await assert.rejects(giftConversationState(pair), error => error.statusCode === 403);
});
test("gift-only message history does not create an active text conversation", async t => {
  t.mock.method(Conversation, "findOne", async () => null);
  t.mock.method(Message, "exists", async filter => { assert.deepEqual(filter.mediaType, { $ne: "gift" }); return null; });
  const write = t.mock.method(Conversation, "findOneAndUpdate", async () => ({}));
  assert.equal(await findConversationState(pair), null);
  assert.equal(write.mock.callCount(), 0);
});
test("existing legacy text conversations still restore their active state", async t => {
  t.mock.method(Conversation, "findOne", async () => null);
  t.mock.method(Message, "exists", async () => ({ _id: "text" }));
  t.mock.method(Conversation, "findOneAndUpdate", async (_filter, update) => { assert.equal(update.$setOnInsert.status, "ACTIVE"); return update.$setOnInsert; });
  assert.equal((await findConversationState(pair)).status, "ACTIVE");
});
