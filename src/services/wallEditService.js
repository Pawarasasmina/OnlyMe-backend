import ApiError from "../utils/ApiError.js";
import { wallClosedReason } from "./wallLifecycleService.js";
export const WALL_EDIT_MS = 15 * 60000;
export function wallEditDeadline(post) {
  const stamp = new Date(post.publishedAt || post.createdAt).getTime();
  return Number.isFinite(stamp) ? new Date(stamp + WALL_EDIT_MS) : null;
}
export function canEditWallNote(post, now = Date.now()) {
  const deadline = wallEditDeadline(post);
  return post.status === "published" && !post.deletedAt && !post.moderationHiddenAt && !["PENDING_REVIEW", "REJECTED"].includes(post.moderationStatus) && !wallClosedReason(post, now) && deadline && Number(now) < deadline.getTime();
}
export function assertWallEditAllowed(post, now = Date.now()) {
  if (!canEditWallNote(post, now)) throw new ApiError(409, "You can edit an active note for 15 minutes after publication.", "WALL_EDIT_EXPIRED");
}
export function wallNoteVersion(post) {
  const fields = ["text", "media", "price", "currency", "countryCode", "location", "rightNow", "postType", "topic", "context", "entityRefs"];
  return Object.fromEntries(fields.map(key => [key, post[key] ?? null]));
}
