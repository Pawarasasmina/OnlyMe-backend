import ProtectedUsername from "../models/ProtectedUsername.js";
import User from "../models/User.js";
import UsernameReservation from "../models/UsernameReservation.js";
import ApiError from "../utils/ApiError.js";
import { normalizeUsername, validateUsername } from "../validators/profileValidator.js";

export async function usernameConflict(username, { userId = null } = {}) {
  const normalized = validateUsername(username);
  const now = new Date();
  const otherUser = userId ? { $ne: userId } : { $exists: true };
  const [user, temporary, protectedName] = await Promise.all([
    User.exists({ username: normalized, ...(userId ? { _id: otherUser } : {}) }),
    UsernameReservation.exists({ username: normalized, ...(userId ? { user: otherUser } : {}), expiresAt: { $gt: now } }),
    ProtectedUsername.findOne({ username: normalized, active: true }).select("protectedUser kind").lean(),
  ]);
  const protectedForAnother = protectedName && (!userId || !protectedName.protectedUser || String(protectedName.protectedUser) !== String(userId));
  if (user) return { type: "ACTIVE", username: normalized };
  if (temporary) return { type: "TEMPORARY", username: normalized };
  if (protectedForAnother) return { type: protectedName.kind, username: normalized };
  return null;
}

export async function requireUsernameAvailable(username, options = {}) {
  const normalized = normalizeUsername(username);
  const conflict = await usernameConflict(normalized, options);
  if (conflict) throw new ApiError(409, conflict.type === "ACTIVE" || conflict.type === "TEMPORARY" ? "That username is already taken" : "That username is protected");
  return normalized;
}

export async function protectVerifiedHandle(user, username, reason = "Verified creator handle protection") {
  if (!user?.isVerified || !username) return null;
  return ProtectedUsername.findOneAndUpdate(
    { username: normalizeUsername(username) },
    { $set: { kind: "VERIFIED_HANDLE", protectedUser: user._id, reason, active: true, disabledAt: null, disabledBy: null } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}
