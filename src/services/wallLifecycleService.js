export const DAY_MS = 86400000;
export const WALL_LIFETIME_DAYS = { Company: 7, "Need Help": 7, "Looking for": 14, Question: 30, "Buy & Sell": 30, Offering: 30, Recommendation: 104, Event: 7, "Right Now": 1 };
const LEGACY = { RIGHT_NOW: "Right Now", NEED_HELP: "Need Help", "Need help": "Need Help", "Looking for": "Looking for", Advice: "Question", "Buy/Sell": "Buy & Sell", Shopping: "Buy & Sell", Recommendation: "Recommendation", Events: "Event", "Right now": "Right Now" };
export function wallKind(post) { return post.rightNow || post.postType === "Right Now" || post.context === "Right now" ? "Right Now" : post.postType || LEGACY[post.context] || ""; }
export function wallLifetimeDays(post) { return WALL_LIFETIME_DAYS[wallKind(post)] || null; }
export function wallExpiresAt(post) {
 const days = wallLifetimeDays(post);
 const stamp = new Date(post.bumpedAt || post.publishedAt || post.createdAt).getTime();
 return days && Number.isFinite(stamp) ? new Date(stamp + days * DAY_MS) : null;
}
export function wallClosedReason(post, now = Date.now()) {
 if (post.resolvedAt) return "resolved";
 const expiry = wallExpiresAt(post);
 if (!expiry || Number(now) < expiry.getTime()) return "";
 return wallKind(post) === "Event" ? "ended" : wallKind(post) === "Recommendation" ? "outdated" : "expired";
}
export function wallLifecycleStatus(post, now = Date.now()) {
 const reason = wallClosedReason(post, now);
 if (reason !== "resolved") return reason || "active";
 return ({ "Buy & Sell": "sold", Offering: "unavailable", Recommendation: "outdated", Event: "ended" })[wallKind(post)] || "solved";
}
export function wallPromptKind(post) {
 const kind = wallKind(post);
 return ["Need Help", "Looking for", "Question"].includes(kind) ? "request" : ["Buy & Sell", "Offering"].includes(kind) ? "availability" : kind === "Recommendation" ? "recommendation" : "";
}
export function wallNeedsExpiryPrompt(post, now = Date.now()) {
 if (wallClosedReason(post, now) || post.moderationHiddenAt || ["PENDING_REVIEW", "REJECTED"].includes(post.moderationStatus)) return false;
 const kind = wallKind(post), expiry = wallExpiresAt(post);
 if (kind === "Recommendation" && (post.outdatedConcern || (post.outdatedVoters || []).length >= 3)) return true;
 if (!expiry) return false;
 const age = Number(now) - new Date(post.bumpedAt || post.publishedAt || post.createdAt).getTime();
 return wallPromptKind(post) === "request" ? expiry.getTime() - Number(now) <= DAY_MS : kind === "Recommendation" ? age >= 90 * DAY_MS : ["Buy & Sell", "Offering"].includes(kind) && age >= 14 * DAY_MS;
}
export function wallCanBump(post, now = Date.now()) {
 return wallNeedsExpiryPrompt(post, now) && (post.bumpCount || 0) < 3 && (!post.bumpedAt || Number(now) - new Date(post.bumpedAt).getTime() >= 7 * DAY_MS);
}
const kindExpression = { $cond: [{ $or: [{ $eq: ["$rightNow", true] }, { $eq: ["$postType", "Right Now"] }, { $eq: ["$context", "Right now"] }] }, "Right Now", { $cond: [{ $ne: [{ $ifNull: ["$postType", ""] }, ""] }, "$postType", { $switch: { branches: Object.entries(LEGACY).map(([context, kind]) => ({ case: { $eq: ["$context", context] }, then: kind })), default: "" } }] }] };
const stampExpression = { $ifNull: ["$bumpedAt", { $ifNull: ["$publishedAt", "$createdAt"] }] };
export function wallActiveExpression(now = new Date()) {
 return { $and: [
  { $eq: [{ $ifNull: ["$resolvedAt", null] }, null] },
  { $switch: { branches: Object.entries(WALL_LIFETIME_DAYS).map(([kind, days]) => ({ case: { $eq: [kindExpression, kind] }, then: { $gt: [stampExpression, new Date(now.getTime() - days * DAY_MS)] } })), default: true } },
 ] };
}
export function wallBumpExpression(now = new Date()) {
 const thresholds = { "Need Help": 6, "Looking for": 13, Question: 29, "Buy & Sell": 14, Offering: 14, Recommendation: 90 };
 return { $and: [wallActiveExpression(now),
  { $lt: [{ $ifNull: ["$bumpCount", 0] }, 3] },
  { $lte: [{ $ifNull: ["$bumpedAt", new Date(0)] }, new Date(now.getTime() - 7 * DAY_MS)] },
  { $switch: { branches: Object.entries(thresholds).map(([kind, days]) => ({ case: { $eq: [kindExpression, kind] }, then: { $or: [{ $lte: [stampExpression, new Date(now.getTime() - days * DAY_MS)] }, ...(kind === "Recommendation" ? [{ $gte: [{ $size: { $ifNull: ["$outdatedVoters", []] } }, 3] }] : [])] } })), default: false } },
 ] };
}
