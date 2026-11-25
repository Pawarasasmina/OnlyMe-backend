import MessageReport from "../models/MessageReport.js";
import User from "../models/User.js";
import PlatformSetting from "../models/PlatformSetting.js";
import Notification from "../models/Notification.js";
import { wallReporterQualification } from "./wallReportService.js";

export const DEFAULT_MEETUP_POLICY = Object.freeze({ unsafeUrgentHours: 4, unsafeReportThreshold: 3, unsafeReportWindowDays: 30, unsafeRestrictionDays: 1 });
export function normalizeMeetupPolicy(value = {}) {
  const range = (key, min, max) => Math.min(max, Math.max(min, Math.round(Number(value[key]) || DEFAULT_MEETUP_POLICY[key])));
  return { unsafeUrgentHours: range("unsafeUrgentHours", 1, 4), unsafeReportThreshold: range("unsafeReportThreshold", 3, 20), unsafeReportWindowDays: range("unsafeReportWindowDays", 1, 90), unsafeRestrictionDays: range("unsafeRestrictionDays", 1, 30) };
}

export async function refreshUnsafeAccountRestriction(userId) {
  userId = userId?._id || userId;
  const [user, settings] = await Promise.all([User.findById(userId).select("unsafeRestrictedUntil unsafeRestrictionLiftedAt").lean(), PlatformSetting.findOne({ key: "moderation-policy" }).lean()]);
  if (!user) return;
  const policy = normalizeMeetupPolicy(settings?.value);
  const now = new Date();
  const expired = user.unsafeRestrictedUntil && new Date(user.unsafeRestrictedUntil) <= now;
  const since = new Date(Math.max(now.getTime() - policy.unsafeReportWindowDays * 86400000, new Date(user.unsafeRestrictionLiftedAt || 0).getTime(), expired ? new Date(user.unsafeRestrictedUntil).getTime() : 0));
  const reports = await MessageReport.find({ reportedUser: userId, scope: "FEED_POST", reason: "UNSAFE_MEETUP", source: "USER_REPORT", createdAt: { $gt: since }, $or: [{ status: { $in: ["RECEIVED", "REVIEWING"] } }, { status: "RESOLVED", "resolution.falseReport": { $ne: true }, "resolution.action": { $nin: [null, "NO_ACTION", "RESTRICTION_LIFTED"] } }] }).select("reporter").lean();
  const reporters = [...new Set(reports.map(row => String(row.reporter)).filter(id => id && id !== String(userId)))];
  const qualifies = await Promise.all(reporters.map(wallReporterQualification));
  const count = qualifies.filter(Boolean).length;
  if (count < policy.unsafeReportThreshold) {
    if (user.unsafeRestrictedUntil) await User.updateOne({ _id: userId }, { $set: { unsafeRestrictedUntil: null, unsafeRestrictionReason: "", ...(expired ? { unsafeRestrictionLiftedAt: user.unsafeRestrictedUntil } : {}) } });
    return;
  }
  // An expired restriction is not renewed by the same old reports.
  if (user.unsafeRestrictedUntil && !expired) return;
  const until = new Date(now.getTime() + policy.unsafeRestrictionDays * 86400000);
  const updated = await User.findOneAndUpdate({ _id: userId, unsafeRestrictedUntil: user.unsafeRestrictedUntil || null }, { $set: { unsafeRestrictedUntil: until, unsafeRestrictionReason: `${count} independent qualified unsafe meet-up reports; restricted pending safety review`, ...(expired ? { unsafeRestrictionLiftedAt: user.unsafeRestrictedUntil } : {}) }, $inc: { authVersion: 1 } }, { new: true });
  if (updated) await Notification.create({ user: userId, type: "moderation_action", title: "Meet-up safety restriction", message: `Your account is temporarily restricted until ${until.toISOString()} after repeated unsafe meet-up reports. Contact hello@atseen.com if you believe this is a mistake.`, severity: "warning", dedupeKey: `meetup-safety:${userId}:${until.toISOString()}` });
}
