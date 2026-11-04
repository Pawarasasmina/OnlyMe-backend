import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import User from "../models/User.js";
import MemberSequence from "../models/MemberSequence.js";
import { nextMemberNumber } from "./memberTicketService.js";
import { updateMyPrivacySettings } from "../controllers/profileController.js";
import FanProfile from "../models/FanProfile.js";

test("ticket number has a unique sparse index and cannot be changed through normal user updates", () => {
  assert.equal(User.schema.path("memberNumber").options.immutable, true);
  assert.ok(User.schema.indexes().some(([keys, options]) => keys.memberNumber === 1 && options.unique && options.sparse));
});

test("concurrent allocations, user assignment, and synced visibility", { skip: process.env.TICKET_MONGO_INTEGRATION !== "1", timeout: 180000 }, async () => {
  const server = await MongoMemoryServer.create();
  try {
    await mongoose.connect(server.getUri());
    await Promise.all([User.init(), MemberSequence.init(), FanProfile.init()]);
    const numbers = await Promise.all(Array.from({ length: 20 }, () => nextMemberNumber()));
    assert.equal(new Set(numbers).size, 20);
    assert.deepEqual([...numbers].sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 1));
    const user = await User.create({ name: "Ticket Test", username: "tickettest", email: "ticket@example.com", password: "TestPassword123" });
    assert.equal(user.memberNumber, 21);
    await User.collection.insertOne({ name: "Imported User", username: "importeduser", email: "imported@example.com", password: "unused", memberNumber: 83 });
    assert.equal(await nextMemberNumber(), 84);
    await User.updateOne({ _id: user._id }, { $set: { memberNumber: 9999 } });
    assert.equal((await User.findById(user._id)).memberNumber, 21);
    await FanProfile.create({ user: user._id, privacySettings: { allowMentions: false } });
    let result;
    const response = { status() { return this; }, json(body) { result = body; return this; } };
    let failure;
    await updateMyPrivacySettings({ user, body: { showMemberNumber: false } }, response, error => { failure = error; });
    assert.ifError(failure);
    assert.equal(result.data.showMemberNumber, false);
    assert.equal((await User.findById(user._id)).showMemberNumber, false);
    assert.equal((await FanProfile.findOne({ user: user._id })).privacySettings.allowMentions, false);
    await updateMyPrivacySettings({ user, body: { showMemberNumber: "false" } }, response, error => { failure = error; });
    assert.equal(failure.statusCode, 400);
  } finally {
    await mongoose.disconnect();
    await server.stop();
  }
});
