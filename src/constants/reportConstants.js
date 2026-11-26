export const REPORT_REASONS = Object.freeze([
  "UNSAFE_MEETUP", "SPAM", "FALSE_INFORMATION", "DEFAMATION", "HARASSMENT", "HATE", "NUDITY",
  "SEXUAL_CONTENT", "VIOLENCE", "SELF_HARM", "ILLEGAL_CONTENT", "COPYRIGHT", "IMPERSONATION",
  "CHILD_SAFETY", "SCAM", "OTHER",
]);

export const REPORT_REASON_SET = new Set(REPORT_REASONS);
export const URGENT_REPORT_REASONS = new Set(["UNSAFE_MEETUP", "CHILD_SAFETY", "SEXUAL_CONTENT", "VIOLENCE", "SELF_HARM"]);

export function normalizeReportReason(value, fallback = "OTHER") {
  const reason = String(value || fallback).trim().toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_");
  return REPORT_REASON_SET.has(reason) ? reason : null;
}
