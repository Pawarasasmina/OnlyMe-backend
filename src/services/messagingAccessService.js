import ApiError from "../utils/ApiError.js";

export function activeMessagingRestriction(user, now = new Date()) {
  const until = user?.messagingRestrictedUntil;
  return Boolean(until && new Date(until).getTime() > now.getTime());
}

export function assertMessagingAccess(user) {
  if (!activeMessagingRestriction(user)) return;
  throw new ApiError(
    403,
    `Messaging access is restricted until ${new Date(user.messagingRestrictedUntil).toISOString()}`,
    "MESSAGING_RESTRICTED",
  );
}

export function requireMessagingAccess(req, _res, next) {
  assertMessagingAccess(req.user);
  next();
}
