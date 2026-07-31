import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import CreatorProfile from "../models/CreatorProfile.js";
import CreatorVerification from "../models/CreatorVerification.js";
import Notification from "../models/Notification.js";
import VerificationFileCleanup from "../models/VerificationFileCleanup.js";
import VerificationReviewHistory from "../models/VerificationReviewHistory.js";
import User from "../models/User.js";
import {
  analyzeCreatorVerificationState,
  expectedAccessForVerification,
  legacyVerificationStatus,
} from "../services/creatorVerificationMigrationService.js";

const dryRun = process.argv.includes("--dry-run");
const now = new Date();

async function inspectCreators() {
  const creators = await User.find({ role: "creator" }).select("creatorApprovalStatus isVerified").lean();
  const report = {
    dryRun,
    counts: { creators: creators.length, approved: 0, pending: 0, rejected: 0, inconsistent: 0, missingProfiles: 0, missingVerifications: 0 },
    inconsistentRecords: [],
  };
  const records = [];

  for (const user of creators) {
    const [profile, verification] = await Promise.all([
      CreatorProfile.findOne({ user: user._id }).lean(),
      CreatorVerification.findOne({ creator: user._id }).lean(),
    ]);
    const hasLegacyHistory = verification
      ? Boolean(await VerificationReviewHistory.exists({ verification: verification._id, action: "LEGACY_MIGRATED" }))
      : false;
    const assessment = analyzeCreatorVerificationState({ user, profile, verification, hasLegacyHistory });
    const approval = user.creatorApprovalStatus || "pending";
    report.counts[approval] += 1;
    if (!profile) report.counts.missingProfiles += 1;
    if (!verification) report.counts.missingVerifications += 1;
    if (assessment.mismatches.length) {
      report.counts.inconsistent += 1;
      report.inconsistentRecords.push({
        creatorId: String(user._id),
        userApproval: user.creatorApprovalStatus,
        userIsVerified: user.isVerified,
        profileStatus: profile?.verificationStatus || null,
        verificationStatus: verification?.status || null,
        reconciliation: assessment.reconciliation,
        mismatches: assessment.mismatches,
      });
    }
    records.push({ user, profile, verification, hasLegacyHistory, assessment });
  }
  return { records, report };
}

async function createLegacyVerification(record) {
  const status = legacyVerificationStatus(record.assessment.normalizedApproval);
  const verification = await CreatorVerification.create({
    creator: record.user._id,
    status,
    rejectionReason: status === "REJECTED" ? "Rejected before document verification migration" : "",
    creatorVisibleMessage: status === "REJECTED" ? "Your creator application was previously rejected." : "",
    reviewedAt: ["APPROVED", "REJECTED"].includes(status) ? now : null,
    legacyMigrated: true,
    legacyMigratedAt: now,
  });
  await VerificationReviewHistory.updateOne(
    { transitionId: `legacy-${verification._id}` },
    {
      $setOnInsert: {
        verification: verification._id,
        creator: record.user._id,
        action: "LEGACY_MIGRATED",
        previousStatus: record.assessment.normalizedApproval,
        newStatus: status,
        reason: "Migrated from legacy creator approval state; documents were not reviewed",
        transitionId: `legacy-${verification._id}`,
      },
    },
    { upsert: true, runValidators: true }
  );
  return verification;
}

async function reconcileRecord(record) {
  if (record.user.creatorApprovalStatus == null) {
    await User.updateOne({ _id: record.user._id }, { $set: { creatorApprovalStatus: "pending" } });
  }
  let profile = record.profile ? await CreatorProfile.findById(record.profile._id) : await CreatorProfile.create({ user: record.user._id });
  let verification = record.verification ? await CreatorVerification.findById(record.verification._id) : null;

  if (!verification) {
    verification = await createLegacyVerification(record);
    const legacyProfileStatus = record.assessment.normalizedApproval === "approved"
      ? "verified"
      : record.assessment.normalizedApproval === "rejected" ? "rejected" : "pending";
    if (profile.verificationStatus !== legacyProfileStatus) {
      profile.verificationStatus = legacyProfileStatus;
      await profile.save();
    }
    return;
  }

  if (verification.legacyMigrated && !record.hasLegacyHistory) {
    await VerificationReviewHistory.updateOne(
      { transitionId: `legacy-${verification._id}` },
      { $setOnInsert: { verification: verification._id, creator: record.user._id, action: "LEGACY_MIGRATED", previousStatus: record.assessment.normalizedApproval, newStatus: verification.status, reason: "Repaired missing legacy migration history", transitionId: `legacy-${verification._id}` } },
      { upsert: true, runValidators: true }
    );
  }

  if (record.assessment.reconciliation === "PRESERVE_APPROVED_REQUIRES_MANUAL_REVIEW") return;
  const expected = expectedAccessForVerification(verification.status);
  await User.updateOne(
    { _id: record.user._id },
    { $set: { creatorApprovalStatus: expected.approval, isVerified: expected.isVerified } }
  );
  if (profile.verificationStatus !== expected.profileStatus) {
    profile.verificationStatus = expected.profileStatus;
    await profile.save();
  }
}

async function verifyIndexes() {
  await Promise.all([
    CreatorVerification.createIndexes(),
    VerificationReviewHistory.createIndexes(),
    Notification.createIndexes(),
    VerificationFileCleanup.createIndexes(),
  ]);
  const indexes = await CreatorVerification.collection.indexes();
  const creatorIndex = indexes.find((index) => index.key?.creator === 1);
  if (!creatorIndex?.unique) throw new Error("CreatorVerification creator unique index is missing");
  console.log("Verified CreatorVerification unique creator index.");
}

async function main() {
  await connectDb();
  const { records, report } = await inspectCreators();
  console.log(JSON.stringify(report, null, 2));
  if (dryRun) return;
  for (const record of records) await reconcileRecord(record);
  await verifyIndexes();
  console.log("Creator verification migration completed successfully.");
}

main()
  .catch((error) => {
    console.error("Creator verification migration failed", error);
    process.exitCode = 1;
  })
  .finally(async () => { await mongoose.disconnect(); });
