import FeedPost from "../models/FeedPost.js";
import MessageReport from "../models/MessageReport.js";
import User from "../models/User.js";

export const WALL_REPORT_THRESHOLD = 3;
export const WALL_FALSE_REPORT_THRESHOLD = 3;
export const WALL_UPHELD_ACTIONS = ["HIDDEN", "REMOVED", "WARNING", "POSTING_RESTRICTED", "ACCOUNT_RESTRICTED", "SUSPENDED", "BANNED"];

// These conservative defaults prevent new/test accounts and proven repeat false
// reporters from hiding a neighbour's note. Every report still reaches review.
export function qualifyingWallReporter(user, falseReports = 0, now = Date.now()) {
  return Boolean(user && user.createdAt && user.status === "active" && user.accountType !== "TEST" &&
    Number.isFinite(new Date(user.createdAt).getTime()) && now - new Date(user.createdAt).getTime() >= 7 * 86400000 &&
    falseReports < WALL_FALSE_REPORT_THRESHOLD);
}

export async function wallReporterQualification(userId) {
  const [user, falseReports] = await Promise.all([
    User.findById(userId).select("+accountType status createdAt").lean(),
    MessageReport.countDocuments({ reporter: userId, scope: "FEED_POST", status: "RESOLVED", "resolution.falseReport": true }),
  ]);
  return qualifyingWallReporter(user, falseReports);
}

export async function refreshWallReportVisibility(postId) {
  const allReports = await MessageReport.find({ feedPost: postId, scope: "FEED_POST", source: "USER_REPORT" }).select("reporter qualifiesForWallAutoHide autoHiddenAt status updatedAt").lean();
  const reports = allReports.filter(report => ["RECEIVED", "REVIEWING"].includes(report.status));
  const revision = allReports.map(report => `${String(new Date(report.updatedAt).getTime() || 0).padStart(16, "0")}:${report._id}`).sort().at(-1) || "";
  const people = [...new Set(reports.map(report => String(report.reporter)).filter(id => id && id !== "null"))];
  const qualification = new Map(await Promise.all(people.map(async id => [id, await wallReporterQualification(id)])));
  const qualifying = new Set(reports.filter(report => qualification.get(String(report.reporter))).map(report => String(report.reporter)));
  const urgentHidden = reports.some(report => report.autoHiddenAt);
  const hidden = qualifying.size >= WALL_REPORT_THRESHOLD || urgentHidden;
  // Recomputed from durable reports; repeat reviews/retries never inflate counters.
  await FeedPost.updateOne({ _id: postId, $or: [{ moderationReportRevision: { $exists: false } }, { moderationReportRevision: { $lte: revision } }] }, { $set: { qualifyingReportCount: qualifying.size, moderationHiddenAt: hidden ? new Date() : null, moderationReportRevision: revision } });
  return { qualifyingReportCount: qualifying.size, hidden };
}

export async function applyWallReportOutcome(report) {
  if (report.scope !== "FEED_POST" || !report.feedPost) return;
  if (report.source === "AUTOMATED_DUPLICATE" && report.status === "RESOLVED") {
    const approved = report.resolution?.action === "NO_ACTION";
    const rejected = ["HIDDEN", "REMOVED"].includes(report.resolution?.action);
    if (approved || rejected) await FeedPost.updateOne({ _id: report.feedPost, moderationStatus: "PENDING_REVIEW" }, { $set: {
      moderationStatus: approved ? "APPROVED" : "REJECTED", moderationReason: approved ? "" : report.resolution?.note || "Duplicate content",
      moderationReviewedAt: report.resolvedAt || new Date(), moderationReviewedBy: report.reviewedBy,
      ...(approved ? { visibility: report.snapshot?.previousVisibility || "public" } : {}),
    } });
  }
  await refreshWallReportVisibility(report.feedPost);
  if (report.resolution?.falseReport && report.reporter) {
    const pending = await MessageReport.distinct("feedPost", { reporter: report.reporter, scope: "FEED_POST", status: { $in: ["RECEIVED", "REVIEWING"] } });
    await Promise.all(pending.filter(Boolean).map(refreshWallReportVisibility));
  }
}
