import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import CreatorVerification from "../models/CreatorVerification.js";
import { claimAtomicStatusTransition } from "./atomicStatusTransitionService.js";

const testMongoUri = process.env.TEST_MONGODB_URI;

test("Mongo integration: concurrent approve versus reject has one winner", { skip: !testMongoUri }, async () => {
  await mongoose.connect(testMongoUri);
  const creator = new mongoose.Types.ObjectId();
  const verification = await CreatorVerification.create({ creator, status: "PENDING_REVIEW" });
  try {
    const approve = claimAtomicStatusTransition({
      repository: CreatorVerification,
      id: verification._id,
      expectedStatus: "PENDING_REVIEW",
      targetStatus: "APPROVED",
      update: { lastTransitionId: "integration-approve" },
    });
    const reject = claimAtomicStatusTransition({
      repository: CreatorVerification,
      id: verification._id,
      expectedStatus: "PENDING_REVIEW",
      targetStatus: "REJECTED",
      update: { lastTransitionId: "integration-reject" },
    });
    const results = await Promise.allSettled([approve, reject]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected" && result.reason.statusCode === 409).length, 1);
  } finally {
    await CreatorVerification.deleteOne({ _id: verification._id });
    await mongoose.disconnect();
  }
});
