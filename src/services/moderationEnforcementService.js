import ModerationStrike from "../models/ModerationStrike.js";
import Notification from "../models/Notification.js";
import PayoutHold from "../models/PayoutHold.js";
import User from "../models/User.js";
import { URGENT_REPORT_REASONS } from "../constants/reportConstants.js";

const NON_STRIKE_ACTIONS = new Set(["", "NO_ACTION", "RESTRICTION_LIFTED"]);
const STRIKE_REASON = "Automatic strike 2: posting limited for 7 days";
const id = (value) => value?._id || value;
const authorId = (report) => id(report.reportedUser) || id(report.creator);
const consequence = (count) => count >= 3 ? "BANNED" : count === 2 ? "POSTING_RESTRICTED_7_DAYS" : "WARNING";

export async function applyResolvedCaseStrike({ report, reportModel, actorId, io }) {
  const action = String(report.resolution?.action || "").toUpperCase();
  if (!authorId(report) || NON_STRIKE_ACTIONS.has(action) || report.resolution?.falseReport) return null;
  const existing = await ModerationStrike.findOne({ reportModel, reportId: report._id });
  if (existing) return existing;
  const count = await ModerationStrike.countDocuments({ user: authorId(report), active: true });
  const nextCount = count + 1;
  let strike;
  try {
    strike = await ModerationStrike.create({ user: authorId(report), reportModel, reportId: report._id, category: report.reason || "OTHER", scope: report.scope || report.kind || "CONTENT", resolutionAction: action, resolvedBy: actorId, resolvedAt: report.resolvedAt || new Date(), strikeNumberAtIssue: nextCount, automaticConsequence: consequence(nextCount) });
  } catch (error) {
    if (error?.code === 11000) return ModerationStrike.findOne({ reportModel, reportId: report._id });
    throw error;
  }
  const user = await User.findById(authorId(report)).select("authVersion status");
  if (!user) return strike;
  if (nextCount >= 3) {
    user.status = "banned";
    user.authVersion = Number(user.authVersion || 0) + 1;
    await user.save();
    io?.in(`user:${user._id}`).disconnectSockets(true);
  } else if (nextCount === 2) {
    const until = new Date(Date.now() + 7 * 86400000);
    await User.updateOne({ _id: user._id }, { $set: { postingRestrictedUntil: until, postingRestrictionReason: STRIKE_REASON } });
  }
  const title = nextCount >= 3 ? "Account banned after 3 safety strikes" : nextCount === 2 ? "Posting limited for 7 days" : "Account warning — strike 1 of 3";
  await Notification.updateOne({ dedupeKey: `moderation-strike:${strike._id}` }, { $setOnInsert: { user: user._id, type: "moderation_warning", title, message: `A confirmed moderation case added strike ${nextCount}. ${nextCount >= 3 ? "Your account has been banned." : nextCount === 2 ? "You cannot publish new content for 7 days." : "Another confirmed case will limit posting for 7 days."}`, severity: nextCount >= 3 ? "critical" : "warning", priority: 100, relatedReport: reportModel === "MessageReport" ? report._id : null, dedupeKey: `moderation-strike:${strike._id}` } }, { upsert: true });
  return strike;
}

export async function reverseCaseStrike({ reportModel, reportId, actorId, reason }) {
  const strike = await ModerationStrike.findOne({ reportModel, reportId, active: true });
  if (!strike) return null;
  strike.active = false; strike.reversedAt = new Date(); strike.reversedBy = actorId; strike.reversalReason = reason; await strike.save();
  const remaining = await ModerationStrike.countDocuments({ user: strike.user, active: true });
  const update = {};
  const user = await User.findById(strike.user).select("status postingRestrictionReason authVersion").lean();
  if (remaining < 3 && strike.automaticConsequence === "BANNED" && user?.status === "banned") Object.assign(update, { status: "active", authVersion: Number(user.authVersion || 0) + 1 });
  if (remaining < 2 && user?.postingRestrictionReason === STRIKE_REASON) Object.assign(update, { postingRestrictedUntil: null, postingRestrictionReason: "" });
  if (Object.keys(update).length) await User.updateOne({ _id: strike.user }, { $set: update });
  return strike;
}

export async function syncSeriousCasePayoutHoldForReport(report, reportModel) {
  if (!authorId(report) || !URGENT_REPORT_REASONS.has(report.reason)) return;
  const ref = { reportModel, reportId: report._id, category: report.reason };
  const open = !["RESOLVED", "CLOSED"].includes(report.status);
  let hold = await PayoutHold.findOne({ user: authorId(report), active: true });
  if (open) {
    if (!hold) {
      await PayoutHold.create({ user: authorId(report), active: true, manualActive: false, seriousCaseRefs: [ref], reason: "Automatic hold while a serious safety case is open", placedBy: null });
    } else if (!hold.seriousCaseRefs?.some((item) => item.reportModel === reportModel && String(item.reportId) === String(report._id))) {
      hold.seriousCaseRefs.push(ref); await hold.save();
    }
    return;
  }
  if (!hold) return;
  hold.seriousCaseRefs = (hold.seriousCaseRefs || []).filter((item) => !(item.reportModel === reportModel && String(item.reportId) === String(report._id)));
  hold.active = hold.manualActive !== false || hold.seriousCaseRefs.length > 0;
  if (!hold.active) { hold.releasedAt = new Date(); hold.releaseReason = "All serious safety cases resolved"; }
  await hold.save();
}

export async function getUserStrikeSummary(userId) {
  const strikes = await ModerationStrike.find({ user: userId }).populate("resolvedBy reversedBy", "name username").sort({ resolvedAt: -1 }).lean();
  const activeCount = strikes.filter((item) => item.active).length;
  return { activeCount, nextConsequence: activeCount >= 3 ? "BANNED" : activeCount === 2 ? "BAN_ON_NEXT_STRIKE" : activeCount === 1 ? "7_DAY_POSTING_LIMIT_ON_NEXT_STRIKE" : "WARNING_ON_NEXT_STRIKE", strikes };
}
