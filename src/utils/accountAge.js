// Birthdays are calendar dates; use UTC to avoid timezone-dependent age changes.
export function accountAge(value, now = new Date()) {
  if (!value) return null;
  if (value instanceof Date && !Number.isFinite(value.getTime())) return null;
  const date = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const birth = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(birth.getTime()) || birth.toISOString().slice(0, 10) !== date || birth > now) return null;
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  if (now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

export function accountAgeBlocked(user, now = new Date()) {
  const age = accountAge(user?.dateOfBirth, now);
  return age !== null && age < 18;
}

import ApiError from "./ApiError.js";

export function assertAccountAge(user) {
  if (accountAgeBlocked(user)) throw new ApiError(403, "You must be 18 or older to use this platform", "MINIMUM_AGE_REQUIRED");
}
