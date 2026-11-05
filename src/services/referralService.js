import crypto from "crypto";
import Referral from "../models/Referral.js";
import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";

export const REFERRAL_CONFIG = Object.freeze({ share: 0, months: 0, invite: 0, spotlightGoal: 2500 });

function codeFor(user, type) {
  const suffix = crypto.createHash("sha256").update(`${user._id}:${type}`).digest("hex").slice(0, 9);
  return `${type === "creator" ? "c" : "f"}-${user.username}-${suffix}`.toLowerCase();
}

export function referralCodes(user) {
  return { creator: codeFor(user, "creator"), friend: codeFor(user, "friend") };
}

export async function resolveReferral(code) {
  const normalized = String(code || "").trim().toLowerCase();
  const match = /^([cf])-([a-z0-9_.]+)-([a-f0-9]{9})$/.exec(normalized);
  if (!match) throw new ApiError(404, "Invitation not found");
  const type = match[1] === "c" ? "creator" : "friend";
  const inviter = await User.findOne({ username: match[2], status: "active" }).select("name username avatar creatorApprovalStatus").lean();
  if (!inviter || codeFor(inviter, type) !== normalized) throw new ApiError(404, "Invitation not found");
  return { code: normalized, inviter: { name: inviter.name, username: inviter.username, avatar: inviter.avatar }, type };
}

export async function attributeReferral({ code, invitee, shareIdentity = true }) {
  if (!shareIdentity || !code) return null;
  const invitation = await resolveReferral(code);
  const inviter = await User.findOne({ username: invitation.inviter.username }).select("_id").lean();
  if (String(inviter._id) === String(invitee._id)) return null;
  const attributedAt = new Date();
  const expiresAt = new Date(attributedAt);
  expiresAt.setMonth(expiresAt.getMonth() + REFERRAL_CONFIG.months);
  const referral = await Referral.findOneAndUpdate(
    { invitee: invitee._id },
    { $setOnInsert: { inviter: inviter._id, invitee: invitee._id, code: invitation.code, type: invitation.type, attributedAt, expiresAt, rewardEligible: false } },
    { new: true, upsert: true }
  );
  if (invitation.type === "friend") {
    const friendIds = await Referral.distinct("invitee", { inviter: inviter._id, type: "friend" });
    if (await User.countDocuments({ _id: { $in: friendIds }, status: "active" }) >= 3) await User.updateOne({ _id: inviter._id, friendInviteRingEarnedAt: null }, { $set: { friendInviteRingEarnedAt: new Date() } });
  }
  return referral;
}

export async function buildGrowDashboard(user) {
  const rows = await Referral.find({ inviter: user._id }).sort({ attributedAt: -1 }).populate("invitee", "name username avatar creatorApprovalStatus").lean();
  const creatorRows = rows.filter((row) => row.type === "creator");
  const friendRows = rows.filter((row) => row.type === "friend");
  const codes = referralCodes(user);
  const person = (value) => value ? { name: value.name, username: value.username, avatar: value.avatar, isCreator: value.creatorApprovalStatus === "approved" } : null;
  const recent = rows.slice(0, 20).map((row) => ({ id: String(row._id), type: row.type, attributedAt: row.attributedAt, person: person(row.invitee) }));
  const invitedCreators = creatorRows.slice(0, 20).map((row) => ({ id: String(row._id), type: row.type, attributedAt: row.attributedAt, person: person(row.invitee) }));
  const total = rows.length;
  return {
    config: REFERRAL_CONFIG,
    codes,
    counts: { total, creators: creatorRows.length, friends: friendRows.length, spotlightRemaining: Math.max(0, REFERRAL_CONFIG.spotlightGoal - total) },
    earnings: null,
    recent,
    invitedCreators,
  };
}
