import VerificationFileCleanup from "../models/VerificationFileCleanup.js";
import {
  deleteVerificationDocument,
  quarantineVerificationDocument,
  sweepQuarantinedVerificationDocuments,
} from "./privateDocumentStorageService.js";

export async function prepareVerificationFileCleanup(storageKey, reason) {
  if (!storageKey) return null;
  return VerificationFileCleanup.create({ storageKey, reason, status: "PREPARED" });
}

export async function cancelVerificationFileCleanup(job) {
  if (!job) return;
  await VerificationFileCleanup.deleteOne({ _id: job._id, status: "PREPARED" });
}

export async function processVerificationFileCleanup(job) {
  if (!job) return;
  try {
    let deletionKey = job.quarantinedStorageKey;
    if (!deletionKey) {
      deletionKey = await quarantineVerificationDocument(job.storageKey);
      job.quarantinedStorageKey = deletionKey;
      job.status = "QUARANTINED";
      job.attempts += 1;
      job.lastError = "";
      await job.save();
    }
    await deleteVerificationDocument(deletionKey);
    await VerificationFileCleanup.deleteOne({ _id: job._id });
  } catch (error) {
    job.status = "FAILED";
    job.attempts += 1;
    job.lastError = String(error.message || "File cleanup failed").slice(0, 1000);
    await job.save().catch(() => {});
  }
}

export async function cleanupUnreferencedVerificationFile(storageKey, reason) {
  try {
    const job = await prepareVerificationFileCleanup(storageKey, reason);
    await processVerificationFileCleanup(job);
  } catch {
    const quarantineKey = await quarantineVerificationDocument(storageKey);
    await deleteVerificationDocument(quarantineKey).catch(() => {});
  }
}

export async function retryPendingVerificationFileCleanup(limit = 100) {
  const jobs = await VerificationFileCleanup.find({ status: { $in: ["PREPARED", "QUARANTINED", "FAILED"] } })
    .sort({ createdAt: 1 }).limit(limit);
  for (const job of jobs) await processVerificationFileCleanup(job);
  await sweepQuarantinedVerificationDocuments();
  return jobs.length;
}



