import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Chapter from "../models/Chapter.js";
import Notification from "../models/Notification.js";
import Publication from "../models/Publication.js";
import PublicationReviewHistory from "../models/PublicationReviewHistory.js";
import { moderatePublication } from "./publicationModerationService.js";
import { addChapter, createPublicationDraft, submitPublication, updatePublicationDraft } from "./publicationService.js";

const testMongoUri = process.env.TEST_MONGODB_URI;
const creator = new mongoose.Types.ObjectId();
const admin = new mongoose.Types.ObjectId();
const base = (kind, pricing) => ({ kind, title: "Publication", summary: "Summary", category: "Category", pricing });
const chapter = (isPreview) => ({ title: "Chapter", isPreview, blocks: [{ id: new mongoose.Types.ObjectId().toString(), type: "TEXT", text: "Chapter body" }] });

test("Mongo integration: publication limits, snapshot freeze, and moderation CAS", { skip: !testMongoUri }, async () => {
  await mongoose.connect(testMongoUri); await Publication.syncIndexes(); await Chapter.syncIndexes();
  try {
    const worlds = await Promise.allSettled(Array.from({ length: 3 }, () => createPublicationDraft(creator, base("WORLD", { mode: "ONE_TIME", starsAmount: 10 }))));
    assert.equal(worlds.filter((result) => result.status === "fulfilled").length, 2);
    assert.equal(worlds.filter((result) => result.status === "rejected" && result.reason.statusCode === 409).length, 1);
    const premiums = await Promise.allSettled(Array.from({ length: 2 }, () => createPublicationDraft(creator, base("PREMIUM_WORLD", { mode: "MONTHLY", starsAmount: 90 }))));
    assert.equal(premiums.filter((result) => result.status === "fulfilled").length, 1);

    const seen = await createPublicationDraft(creator, base("SEEN", { mode: "FREE", starsAmount: null })); await Publication.updateOne({ _id: seen._id }, { $set: { coverMedia: { assetId: "test-cover", resourceType: "image", mediaType: "IMAGE", secureUrl: "https://example.test/cover.jpg" } } });
    await addChapter(creator, seen._id, { ...chapter(true), statusVersion: seen.statusVersion });
    const beforeSubmit = await Publication.findById(seen._id);
    const submitted = await submitPublication(creator, seen._id, { statusVersion: beforeSubmit.statusVersion });
    assert.equal(submitted.status, "PENDING_REVIEW"); assert.equal(submitted.submittedSnapshot.chapters.length, 1);
    await assert.rejects(() => updatePublicationDraft(creator, seen._id, { statusVersion: submitted.statusVersion, title: "Changed" }), (error) => error.statusCode === 409);
    const decisions = await Promise.allSettled([
      moderatePublication({ id: seen._id, adminId: admin, decision: "APPROVED", review: { manualReviewConfirmed: true } }),
      moderatePublication({ id: seen._id, adminId: admin, decision: "REJECTED", review: { creatorVisibleMessage: "No", rejectionReason: "Reason" } }),
    ]);
    assert.equal(decisions.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(decisions.filter((result) => result.status === "rejected" && result.reason.statusCode === 409).length, 1);
  } finally {
    const ids = await Publication.find({ creator }).distinct("_id"); await Promise.all([Chapter.deleteMany({ publication: { $in: ids } }), PublicationReviewHistory.deleteMany({ publication: { $in: ids } }), Publication.deleteMany({ _id: { $in: ids } }), Notification.deleteMany({ user: creator })]); await mongoose.disconnect();
  }
});
