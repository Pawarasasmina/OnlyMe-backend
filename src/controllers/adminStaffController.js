import mongoose from "mongoose";
import User from "../models/User.js";
import AdminProfile from "../models/AdminProfile.js";
import AdminAuditEvent from "../models/AdminAuditEvent.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { effectiveAdminRole } from "../middleware/adminPermissionMiddleware.js";

const ROLES = new Set(["MAIN_ADMIN", "MODERATOR", "FINANCE"]);
const clean = (value, max = 500) => String(value || "").trim().slice(0, max);
const safeStaff = (user) => ({ id: user._id, name: user.name, username: user.username, email: user.email, adminRole: user.adminRole || "MAIN_ADMIN", status: user.status, twoFactorEnabled: Boolean(user.adminTwoFactorEnabled), twoFactorRequired: user.adminTwoFactorRequired !== false, createdAt: user.createdAt, lastLoginAt: user.adminProfile?.lastLoginAt || null, createdBy: user.adminCreatedBy || null });

async function audit(req, action, target, reason, before, after) {
  await AdminAuditEvent.create({ actor: req.user._id, actorRole: effectiveAdminRole(req.user), action, targetType: "ADMIN_ACCOUNT", targetId: String(target), reason, before, after, metadata: { ip: req.ip, userAgent: clean(req.get("User-Agent"), 300) } });
}

export const listAdminStaff = asyncHandler(async (_req, res) => {
  const users = await User.find({ role: "admin" }).select("name username email adminRole status adminTwoFactorEnabled adminTwoFactorRequired adminCreatedBy createdAt").sort({ createdAt: -1 }).lean();
  const profiles = await AdminProfile.find({ user: { $in: users.map((item) => item._id) } }).select("user lastLoginAt").lean();
  const byUser = new Map(profiles.map((item) => [String(item.user), item]));
  return sendResponse(res, 200, "Admin staff fetched", { staff: users.map((user) => safeStaff({ ...user, adminProfile: byUser.get(String(user._id)) })) });
});

export const createAdminStaff = asyncHandler(async (req, res) => {
  const name = clean(req.body.name, 120);
  const email = clean(req.body.email, 254).toLowerCase();
  const password = String(req.body.password || "");
  const adminRole = clean(req.body.adminRole, 30).toUpperCase();
  const reason = clean(req.body.reason, 500);
  if (name.length < 2) throw new ApiError(400, "Name must be at least 2 characters");
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new ApiError(400, "Enter a valid email address");
  if (password.length < 8) throw new ApiError(400, "Temporary password must be at least 8 characters");
  if (!ROLES.has(adminRole)) throw new ApiError(400, "Choose Main Admin, Moderator, or Finance");
  if (reason.length < 3) throw new ApiError(400, "A reason is required");
  if (await User.exists({ email })) throw new ApiError(409, "An account already uses this email");
  const base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9._]/g, "").slice(0, 24) || "admin";
  let username = base;
  for (let suffix = 1; await User.exists({ username }); suffix += 1) username = `${base.slice(0, 20)}${suffix}`;
  const user = await User.create({ name, email, username, password, role: "admin", adminRole, adminCreatedBy: req.user._id, status: "active", adminTwoFactorRequired: true, authVersion: 0 });
  await AdminProfile.create({ user: user._id });
  await audit(req, "ADMIN_ACCOUNT_CREATED", user._id, reason, null, { name, email, adminRole, status: "active" });
  return sendResponse(res, 201, "Admin account created", { staff: safeStaff(user) });
});

export const updateAdminStaff = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid admin account ID");
  if (String(req.params.id) === String(req.user._id)) throw new ApiError(400, "Use your own security settings to manage your account");
  const target = await User.findOne({ _id: req.params.id, role: "admin" }).select("name username email adminRole status authVersion createdAt");
  if (!target) throw new ApiError(404, "Admin account not found");
  const adminRole = req.body.adminRole == null ? (target.adminRole || "MAIN_ADMIN") : clean(req.body.adminRole, 30).toUpperCase();
  const status = req.body.status == null ? target.status : clean(req.body.status, 30).toLowerCase();
  const reason = clean(req.body.reason, 500);
  if (!ROLES.has(adminRole) || !["active", "suspended"].includes(status)) throw new ApiError(400, "Invalid role or status");
  if (reason.length < 3) throw new ApiError(400, "A reason is required");
  const currentRole = target.adminRole || "MAIN_ADMIN";
  if (currentRole === "MAIN_ADMIN" && (adminRole !== "MAIN_ADMIN" || status !== "active")) {
    const remaining = await User.countDocuments({ role: "admin", status: "active", $or: [{ adminRole: "MAIN_ADMIN" }, { adminRole: { $exists: false } }, { adminRole: null }] });
    if (remaining <= 1) throw new ApiError(409, "At least one active Main Admin is required");
  }
  const before = { adminRole: currentRole, status: target.status };
  target.adminRole = adminRole;
  target.status = status;
  if (status !== before.status || adminRole !== before.adminRole) target.authVersion = Number(target.authVersion || 0) + 1;
  await target.save();
  await audit(req, "ADMIN_ACCOUNT_UPDATED", target._id, reason, before, { adminRole, status });
  if (status !== before.status || adminRole !== before.adminRole) req.app.get("io")?.in(`user:${target._id}`).disconnectSockets(true);
  return sendResponse(res, 200, "Admin account updated", { staff: safeStaff(target) });
});

export const resetAdminPassword = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid admin account ID");
  if (String(req.params.id) === String(req.user._id)) throw new ApiError(400, "Use password recovery for your own account");
  const password = String(req.body.password || "");
  const reason = clean(req.body.reason, 500);
  if (password.length < 8 || reason.length < 3) throw new ApiError(400, "An 8-character password and reason are required");
  const target = await User.findOne({ _id: req.params.id, role: "admin" }).select("+password adminRole status authVersion");
  if (!target) throw new ApiError(404, "Admin account not found");
  target.password = password;
  target.authVersion = Number(target.authVersion || 0) + 1;
  await target.save();
  await audit(req, "ADMIN_PASSWORD_RESET", target._id, reason, null, { sessionsRevoked: true });
  req.app.get("io")?.in(`user:${target._id}`).disconnectSockets(true);
  return sendResponse(res, 200, "Password reset and sessions revoked");
});

async function applyTwoFactorPolicy(req, targets, action, reason) {
  const requireNew = action === "REQUIRE_NEW";
  const ids = targets.map((target) => target._id);
  await Promise.all([
    User.updateMany({ _id: { $in: ids } }, { $set: { adminTwoFactorEnabled: false, adminTwoFactorRequired: requireNew }, $inc: { authVersion: 1 } }),
    AdminProfile.updateMany({ user: { $in: ids } }, { $set: { twoFactorSecret: "", twoFactorPendingSecret: "", twoFactorEnabledAt: null } }),
  ]);
  await AdminAuditEvent.insertMany(targets.map((target) => ({ actor: req.user._id, actorRole: effectiveAdminRole(req.user), action: requireNew ? "ADMIN_2FA_REENROLLMENT_REQUIRED" : "ADMIN_2FA_DISABLED_BY_MAIN_ADMIN", targetType: "ADMIN_ACCOUNT", targetId: String(target._id), reason, before: { enabled: Boolean(target.adminTwoFactorEnabled), required: target.adminTwoFactorRequired !== false }, after: { enabled: false, required: requireNew }, metadata: { ip: req.ip, userAgent: clean(req.get("User-Agent"), 300) } })));
  ids.forEach((id) => req.app.get("io")?.in(`user:${id}`).disconnectSockets(true));
}

export const updateStaffTwoFactor = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid admin account ID");
  const action = clean(req.body.action, 30).toUpperCase();
  const reason = clean(req.body.reason, 500);
  if (!["DISABLE", "REQUIRE_NEW"].includes(action) || reason.length < 3) throw new ApiError(400, "Choose a 2FA action and provide a reason");
  const target = await User.findOne({ _id: req.params.id, role: "admin" }).select("adminRole adminTwoFactorEnabled adminTwoFactorRequired");
  if (!target) throw new ApiError(404, "Admin account not found");
  await applyTwoFactorPolicy(req, [target], action, reason);
  return sendResponse(res, 200, action === "REQUIRE_NEW" ? "A new authenticator setup is required" : "Two-factor authentication turned off", { staff: safeStaff({ ...target.toObject(), adminTwoFactorEnabled: false, adminTwoFactorRequired: action === "REQUIRE_NEW" }) });
});

export const updateRoleTwoFactor = asyncHandler(async (req, res) => {
  const adminRole = clean(req.body.adminRole, 30).toUpperCase();
  const action = clean(req.body.action, 30).toUpperCase();
  const reason = clean(req.body.reason, 500);
  if (!ROLES.has(adminRole) || !["DISABLE", "REQUIRE_NEW"].includes(action) || reason.length < 3) throw new ApiError(400, "Choose a role, 2FA action, and reason");
  const targets = await User.find({ role: "admin", $or: adminRole === "MAIN_ADMIN" ? [{ adminRole }, { adminRole: { $exists: false } }, { adminRole: null }] : [{ adminRole }] }).select("adminRole adminTwoFactorEnabled adminTwoFactorRequired");
  if (!targets.length) throw new ApiError(404, "No admin accounts use this role");
  await applyTwoFactorPolicy(req, targets, action, reason);
  return sendResponse(res, 200, "Role two-factor policy updated", { affected: targets.length, adminRole, action });
});
