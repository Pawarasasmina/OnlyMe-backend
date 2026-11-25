import mongoose from "mongoose";
import AdminAuditEvent from "../models/AdminAuditEvent.js";
import Notification from "../models/Notification.js";
import ProtectedUsername from "../models/ProtectedUsername.js";
import User from "../models/User.js";
import UsernameReservation from "../models/UsernameReservation.js";
import { effectiveAdminRole } from "../middleware/adminPermissionMiddleware.js";
import { protectVerifiedHandle, requireUsernameAvailable } from "../services/usernameProtectionService.js";
import { normalizeUsername, RESERVED_USERNAMES, validateUsername } from "../validators/profileValidator.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

const clean = (value, max = 1000) => String(value || "").trim().slice(0, max);
const requireReason = value => { const reason = clean(value); if (reason.length < 3) throw new ApiError(400, "Enter a reason with at least 3 characters"); return reason; };
const audit = (req, action, targetType, targetId, reason, before, after, metadata = {}) => AdminAuditEvent.create({ actor: req.user._id, actorRole: effectiveAdminRole(req.user), action, targetType, targetId: String(targetId), reason, before, after, metadata });

export const listProtectedUsernames = asyncHandler(async (req, res) => {
  const q = clean(req.query.q, 60).toLowerCase();
  const filter = { ...(req.query.active === "false" ? { active: false } : req.query.active === "all" ? {} : { active: true }), ...(q ? { username: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } } : {}) };
  const verifiedUsers = await User.find({ isVerified: true, status: "active", role: { $ne: "admin" } }).select("username").lean();
  if (verifiedUsers.length) await ProtectedUsername.bulkWrite(verifiedUsers.map(user => ({ updateOne: { filter: { username: user.username }, update: { $set: { kind: "VERIFIED_HANDLE", protectedUser: user._id, reason: "Verified creator handle protection", active: true, disabledAt: null, disabledBy: null } }, upsert: true } })));
  const [items, lockedUsers, verifiedCount] = await Promise.all([
    ProtectedUsername.find(filter).populate("protectedUser", "name username avatar isVerified").populate("createdBy", "name username").sort({ active: -1, createdAt: -1 }).limit(500).lean(),
    User.countDocuments({ usernameLocked: true }),
    User.countDocuments({ isVerified: true, status: "active" }),
  ]);
  return sendResponse(res, 200, "Username protections fetched", { staticNames: [...RESERVED_USERNAMES].sort(), items, summary: { managed: items.filter(item => item.active).length, lockedUsers, verifiedCreators: verifiedCount } });
});

export const createProtectedUsername = asyncHandler(async (req, res) => {
  const username = validateUsername(req.body.username);
  const reason = requireReason(req.body.reason);
  const kind = ["PLATFORM", "BRAND"].includes(req.body.kind) ? req.body.kind : "PLATFORM";
  if (await User.exists({ username })) throw new ApiError(409, "That username is currently in use. Resolve the account before reserving it");
  const before = await ProtectedUsername.findOne({ username }).lean();
  const item = await ProtectedUsername.findOneAndUpdate({ username }, { $set: { kind, reason, active: true, createdBy: req.user._id, protectedUser: null, disabledAt: null, disabledBy: null } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  await audit(req, before ? "USERNAME_PROTECTION_RESTORED" : "USERNAME_PROTECTION_CREATED", "USERNAME", username, reason, before, item.toObject());
  return sendResponse(res, before ? 200 : 201, "Username protected", { item });
});

export const updateProtectedUsername = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid username protection ID");
  const reason = requireReason(req.body.reason);
  const item = await ProtectedUsername.findById(req.params.id);
  if (!item) throw new ApiError(404, "Username protection not found");
  const before = item.toObject();
  const active = Boolean(req.body.active);
  if (!active && item.kind === "VERIFIED_HANDLE" && item.protectedUser && await User.exists({ _id: item.protectedUser, isVerified: true })) throw new ApiError(409, "A verified creator handle cannot be released while verification is active");
  item.active = active; item.reason = reason; item.disabledAt = active ? null : new Date(); item.disabledBy = active ? null : req.user._id; await item.save();
  await audit(req, active ? "USERNAME_PROTECTION_RESTORED" : "USERNAME_PROTECTION_DISABLED", "USERNAME", item.username, reason, before, item.toObject());
  return sendResponse(res, 200, active ? "Username protection restored" : "Username protection disabled", { item });
});

export const searchUsernameAccounts = asyncHandler(async (req, res) => {
  const q = clean(req.query.q, 80);
  const filter = mongoose.isValidObjectId(q) ? { _id: q } : q ? { $or: [{ username: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } }, { name: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } }, { email: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } }] } : { usernameLocked: true };
  const users = await User.find({ ...filter, role: { $ne: "admin" } }).select("name username email avatar status isVerified usernameLocked usernameLockedAt usernameLockReason usernameChangeRequired usernameChangedAt createdAt").sort({ usernameLocked: -1, createdAt: -1 }).limit(40).lean();
  return sendResponse(res, 200, "Username accounts fetched", { items: users });
});

async function generatedUsername(user) {
  const base = `user_${String(user._id).slice(-8)}`;
  for (let index = 0; index < 20; index += 1) {
    const candidate = index ? `${base}_${index}` : base;
    try { await requireUsernameAvailable(candidate, { userId: user._id }); return candidate; } catch (error) { if (error.statusCode !== 409) throw error; }
  }
  throw new ApiError(409, "Could not generate a safe replacement username");
}

export const actionUsernameAccount = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid user ID");
  const reason = requireReason(req.body.reason);
  const action = String(req.body.action || "").toUpperCase();
  if (!["FORCE_RENAME", "LOCK", "UNLOCK", "RENAME_AND_LOCK"].includes(action)) throw new ApiError(400, "Select a valid username action");
  const user = await User.findOne({ _id: req.params.id, role: { $ne: "admin" } });
  if (!user) throw new ApiError(404, "User not found");
  const before = { username: user.username, usernameLocked: user.usernameLocked, usernameChangeRequired: user.usernameChangeRequired };
  let oldUsername = user.username;
  if (["FORCE_RENAME", "RENAME_AND_LOCK"].includes(action)) {
    const requested = clean(req.body.newUsername, 30);
    const replacement = requested ? validateUsername(requested) : await generatedUsername(user);
    if (replacement === user.username) throw new ApiError(400, "Choose a different replacement username");
    await requireUsernameAvailable(replacement, { userId: user._id });
    await UsernameReservation.findOneAndUpdate({ username: oldUsername }, { $set: { user: user._id, expiresAt: new Date(Date.now() + 14 * 86400000) } }, { upsert: true, setDefaultsOnInsert: true });
    await protectVerifiedHandle(user, oldUsername, `Verified handle retained after administrative rename: ${reason}`);
    user.username = replacement; user.usernameChangedAt = new Date(); user.usernameChangeRequired = action === "FORCE_RENAME" && !requested;
  }
  if (["LOCK", "RENAME_AND_LOCK"].includes(action)) { user.usernameLocked = true; user.usernameLockedAt = new Date(); user.usernameLockedBy = req.user._id; user.usernameLockReason = reason; }
  if (action === "UNLOCK") { user.usernameLocked = false; user.usernameLockedAt = null; user.usernameLockedBy = null; user.usernameLockReason = ""; }
  await user.save();
  const after = { username: user.username, usernameLocked: user.usernameLocked, usernameChangeRequired: user.usernameChangeRequired };
  await Promise.all([
    audit(req, `USERNAME_${action}`, "USER", user._id, reason, before, after, { reportModel: clean(req.body.reportModel, 80), reportId: clean(req.body.reportId, 80), oldUsername }),
    Notification.create({ user: user._id, actor: req.user._id, type: "username_protection", title: action === "UNLOCK" ? "Username unlocked" : action === "LOCK" ? "Username locked" : "Your username was changed", message: `${reason}${user.usernameChangeRequired ? " Choose a new available username in Profile settings." : ""}`, severity: action === "UNLOCK" ? "info" : "warning", priority: 75, metadata: { action, oldUsername, username: user.username } }),
  ]);
  req.app.get("io")?.to(`user:${user._id}`).emit("account:username-updated", after);
  return sendResponse(res, 200, "Username protection action completed", { user: { id: user._id, name: user.name, username: user.username, isVerified: user.isVerified, ...after } });
});
