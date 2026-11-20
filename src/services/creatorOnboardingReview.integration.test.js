import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import User from "../models/User.js";
import CreatorVerification from "../models/CreatorVerification.js";
import PlatformSetting from "../models/PlatformSetting.js";
import Publication from "../models/Publication.js";
import { monetizationSummary, completeMonetizationEligibility, MONETIZATION_POLICY_KEY } from "./monetizationService.js";
import { createPublicationDraft, addChapter, submitPublication } from "./publicationService.js";
import { moderatePublication } from "./publicationModerationService.js";
import { callAvailabilityForUser } from "./callAvailabilityService.js";

test("new creator eligibility and immediate free/paid Seen publishing work end to end", { skip: process.env.CREATOR_SETUP_INTEGRATION !== "1", timeout: 120000 }, async () => {
  const server = await MongoMemoryServer.create({ binary: { version: "8.2.6" } });
  try {
    await mongoose.connect(server.getUri());
    const user = await User.create({ name: "New Creator", username: "new.creator", email: "new@example.test", password: "Password123!", dateOfBirth: new Date("1995-04-12"), profileAccountType: "creator", creatorApprovalStatus: "approved", status: "active" });
    await PlatformSetting.create({ key: MONETIZATION_POLICY_KEY, value: { enabled: true, supportedCountries: ["Sri Lanka"], termsVersion: "test-v1" } });
    assert.equal((await monetizationSummary(user)).hasDateOfBirth, true);
    const saved = await completeMonetizationEligibility(user, { country: "Sri Lanka", acceptTerms: true, termsVersion: "test-v1" });
    assert.equal(saved.eligibility.terms, true);
    assert.equal(saved.enabled, false, "Identity must still be approved");
    await CreatorVerification.collection.insertOne({ creator: user._id, purpose: "IDENTITY", status: "APPROVED", ageConfirmed: true, dateOfBirth: user.dateOfBirth, country: "Sri Lanka" });
    assert.equal((await monetizationSummary(await User.findById(user._id))).enabled, true);
    assert.equal((await callAvailabilityForUser(user._id)).available, true);
    await PlatformSetting.updateOne({ key: MONETIZATION_POLICY_KEY }, { $set: { "value.blockedCallCountries": ["AE", "LK"] } });
    assert.equal((await callAvailabilityForUser(user._id)).available, false);
    assert.equal((await monetizationSummary(await User.findById(user._id))).enabled, true, "Call restrictions do not disable other money features");
    await PlatformSetting.updateOne({ key: MONETIZATION_POLICY_KEY }, { $set: { "value.blockedCallCountries": [] } });
    assert.equal((await callAvailabilityForUser(user._id)).available, true);
    for (const paid of [false, true]) {
      const draft = await createPublicationDraft(user._id, { kind: "SEEN", title: paid ? "Paid Seen" : "Free Seen", summary: "A practical guide", category: "Lifestyle", visibility: "PUBLIC", pricing: paid ? { mode: "ONE_TIME", starsAmount: 190 } : { mode: "FREE", starsAmount: null } });
      for (let i = 0; i < (paid ? 3 : 1); i++) {
        const current = await Publication.findById(draft._id);
        await addChapter(user._id, draft._id, { title: `Chapter ${i + 1}`, isPreview: i === 0, blocks: [{ id: `text-${i}`, type: "TEXT", text: "Useful guidance." }], statusVersion: current.statusVersion });
      }
      const current = await Publication.findById(draft._id);
      const submitted = await submitPublication(user._id, draft._id, { statusVersion: current.statusVersion });
      assert.equal(submitted.status, "PUBLISHED");
      assert.equal(submitted.publishedSnapshot.metadata.title, submitted.title);
      assert.equal(submitted.publishedSnapshot.chapters.length, paid ? 3 : 1);
      assert.equal(await Publication.countDocuments({ _id: draft._id, status: "PUBLISHED" }), 1);
      await assert.rejects(moderatePublication({ id: draft._id, adminId: new mongoose.Types.ObjectId(), decision: "APPROVED", review: { manualReviewConfirmed: true } }), error => error.statusCode === 404);
    }
  } finally {
    await mongoose.disconnect();
    await server.stop();
  }
});
