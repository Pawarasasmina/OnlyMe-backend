import crypto from "crypto";
import Referral from "../models/Referral.js";
import User from "../models/User.js";
import ReferralEarning from "../models/ReferralEarning.js";
import { getStarExchangeRate } from "./starExchangeService.js";
import ApiError from "../utils/ApiError.js";

export const REFERRAL_CONFIG = Object.freeze({ share: 0.90, months: 12, invite: 0.05, spotlightGoal: 2500 });

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

export async function attributeReferral({ code, invitee }) {
  if (!code) return null;
  const invitation = await resolveReferral(code);
  const inviter = await User.findOne({ username: invitation.inviter.username }).select("_id").lean();
  if (String(inviter._id) === String(invitee._id)) return null;
  const attributedAt = new Date();
  const expiresAt = new Date(attributedAt);
  expiresAt.setMonth(expiresAt.getMonth() + REFERRAL_CONFIG.months);
  return Referral.findOneAndUpdate(
    { invitee: invitee._id },
    { $setOnInsert: { inviter: inviter._id, invitee: invitee._id, code: invitation.code, type: invitation.type, attributedAt, expiresAt } },
    { new: true, upsert: true }
  );
}

export async function buildGrowDashboard(user) {
  const [rows, earningRows, starsPerUsd] = await Promise.all([
    Referral.find({ inviter: user._id }).sort({ attributedAt: -1 }).populate("invitee", "name username avatar creatorApprovalStatus").lean(),
    ReferralEarning.find({ referrer: user._id, status: "SETTLED" }).sort({ createdAt: -1 }).limit(50).populate("referredUser", "name username avatar creatorApprovalStatus").lean(),
    getStarExchangeRate(),
  ]);
  const creatorRows = rows.filter((row) => row.type === "creator");
  const friendRows = rows.filter((row) => row.type === "friend");
  const codes = referralCodes(user);
  const person = (value) => value ? { name: value.name, username: value.username, avatar: value.avatar, isCreator: value.creatorApprovalStatus === "approved" } : null;
  const recent = earningRows.slice(0, 20).map((row) => ({ id: String(row._id), type: row.relationshipType, attributedAt: row.createdAt, earningsAmount: row.rewardStars / starsPerUsd, coins: row.rewardStars, person: person(row.referredUser) }));
  const creatorTotals = new Map();
  earningRows.filter((row) => row.relationshipType === "creator").forEach((row) => creatorTotals.set(String(row.referredUser?._id || row.referredUser), (creatorTotals.get(String(row.referredUser?._id || row.referredUser)) || 0) + row.rewardStars));
  const invitedCreators = creatorRows.slice(0, 20).map((row) => ({ id: String(row._id), type: row.type, attributedAt: row.attributedAt, expiresAt: row.expiresAt, earningsAmount: (creatorTotals.get(String(row.invitee?._id || row.invitee)) || 0) / starsPerUsd, coins: creatorTotals.get(String(row.invitee?._id || row.invitee)) || 0, person: person(row.invitee) }));
  const total = rows.length;
  const earningsStars = earningRows.reduce((sum, row) => sum + row.rewardStars, 0);
  return {
    config: REFERRAL_CONFIG,
    codes,
    counts: { total, creators: creatorRows.length, friends: friendRows.length, spotlightRemaining: Math.max(0, REFERRAL_CONFIG.spotlightGoal - total) },
    earnings: { amount: earningsStars / starsPerUsd, coins: earningsStars, currency: "USD", note: "Referral earnings appear after eligible sales are settled." },
    recent,
    invitedCreators,
  };
}
