import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import User from "../models/User.js";
import Referral from "../models/Referral.js";
import { getMyInvitations } from "./profileController.js";
import { resolveReferral } from "../services/referralService.js";

test("personal invitations return a usable friend code and only the owner's friend count", { skip: process.env.INVITATIONS_MONGO_TEST !== "1", timeout: 180000 }, async () => {
  const server = await MongoMemoryServer.create();
  try {
    await mongoose.connect(server.getUri());
    const user = await User.create({ name: "Invitation Test", username: "invitationtest", email: "invitation@example.com", password: "TestPassword123", role: "fan" });
    const joined = await User.create({ name: "Joined Friend", username: "joinedfriend", email: "joinedfriend@example.com", password: "TestPassword123", role: "fan" });
    await Referral.create([
      { inviter: user._id, invitee: joined._id, code: "friend", type: "friend", expiresAt: new Date(Date.now() + 86400000) },
      { inviter: user._id, invitee: new mongoose.Types.ObjectId(), code: "creator", type: "creator", expiresAt: new Date(Date.now() + 86400000) },
      { inviter: new mongoose.Types.ObjectId(), invitee: new mongoose.Types.ObjectId(), code: "other", type: "friend", expiresAt: new Date(Date.now() + 86400000) },
    ]);
    let response;
    let failure;
    await getMyInvitations({ user }, { status() { return this; }, json(body) { response = body; return this; } }, error => { failure = error; });
    assert.ifError(failure);
    assert.equal(response.data.joinedCount, 1);
    assert.equal((await resolveReferral(response.data.code)).inviter.username, user.username);
    assert.deepEqual(Object.keys(response.data).sort(), ["code", "creators", "friends", "joinedCount", "ringEarned"]);
  } finally { await mongoose.disconnect(); await server.stop(); }
});
