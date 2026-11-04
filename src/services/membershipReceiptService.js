import Notification from "../models/Notification.js";
import { sendEmail } from "./emailService.js";

export async function sendMembershipCancellationReceipt(user, membership) {
  const end = new Date(membership.currentPeriodEnd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const key = `membership-cancel:${membership.id}:${new Date(membership.canceledAt || membership.currentPeriodEnd).getTime()}`;
  const message = `Your membership is cancelled. Access stays open until ${end}. You won’t be charged again.`;
  await Notification.updateOne({ dedupeKey: key }, { $setOnInsert: { user: user._id, type: "membership_cancelled", title: "Membership cancelled", message, dedupeKey: key, metadata: { membershipId: membership.id, currentPeriodEnd: membership.currentPeriodEnd } } }, { upsert: true });
  if (!user.email) return { delivered: false };
  return sendEmail({ to: user.email, subject: "Your World membership is cancelled", text: message, idempotencyKey: key });
}
