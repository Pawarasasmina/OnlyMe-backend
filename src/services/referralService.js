import crypto from "crypto";
import Referral from "../models/Referral.js";
import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";
import ReferralEarning from "../models/ReferralEarning.js";
import { getStarExchangeRate } from "./starExchangeService.js";
import { getCreatorReferralPolicy } from "./creatorReferralPolicyService.js";
import AnalyticsSession from "../models/AnalyticsSession.js";
import StarsLedgerEntry from "../models/StarsLedgerEntry.js";

export const REFERRAL_CONFIG = Object.freeze({ share: 0, months: 12, invite: 0, spotlightGoal: 2500 });

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

export async function attributeReferral({ code, invitee, shareIdentity = true, sessionId = "" }) {
  if (!shareIdentity || !code) return null;
  const invitation = await resolveReferral(code);
  const inviter = await User.findOne({ username: invitation.inviter.username }).select("_id").lean();
  if (String(inviter._id) === String(invitee._id)) return null;
  const attributedAt = new Date();
  const expiresAt = new Date(attributedAt);
  expiresAt.setMonth(expiresAt.getMonth() + REFERRAL_CONFIG.months);
  const firstPayoutAt = new Date(attributedAt.getTime() + 60 * 24 * 60 * 60 * 1000);
  const sameDevice = Boolean(sessionId && await AnalyticsSession.exists({ sessionId: String(sessionId).slice(0, 80), userId: inviter._id }));
  const referral = await Referral.findOneAndUpdate(
    { invitee: invitee._id },
    { $setOnInsert: { inviter: inviter._id, invitee: invitee._id, code: invitation.code, type: invitation.type, attributedAt, expiresAt, firstPayoutAt, rewardEligible: invitation.type === "creator" && !sameDevice, exclusionReason: sameDevice ? "SAME_DEVICE" : "" } },
    { new: true, upsert: true }
  );
  if (invitation.type === "friend") {
    const friendIds = await Referral.distinct("invitee", { inviter: inviter._id, type: "friend" });
    if (await User.countDocuments({ _id: { $in: friendIds }, status: "active" }) >= 3) await User.updateOne({ _id: inviter._id, friendInviteRingEarnedAt: null }, { $set: { friendInviteRingEarnedAt: new Date() } });
  }
  return referral;
}

export async function buildGrowDashboard(user) {
  const [rows, policy, starsPerUsd] = await Promise.all([
    Referral.find({ inviter: user._id }).sort({ attributedAt: -1 }).populate("invitee", "name username avatar creatorApprovalStatus").lean(),
    getCreatorReferralPolicy(),
    getStarExchangeRate(),
  ]);
  const creatorRows = rows.filter((row) => row.type === "creator");
  const friendRows = rows.filter((row) => row.type === "friend");
  const codes = referralCodes(user);
  const person = (value) => value ? { name: value.name, username: value.username, avatar: value.avatar, isCreator: value.creatorApprovalStatus === "approved" } : null;
  const recent = rows.slice(0, 20).map((row) => ({ id: String(row._id), type: row.type, attributedAt: row.attributedAt, earningsAmount: Number(row.earningsAmount || 0), coins: Number(row.coins || 0), person: person(row.invitee) }));
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const [earnings, creatorIncome] = creatorRows.length ? await Promise.all([ReferralEarning.aggregate([
    { $match: { referral: { $in: creatorRows.map((row) => row._id) }, status: "SETTLED" } },
    { $group: { _id: "$referral", total: { $sum: "$rewardStars" }, month: { $sum: { $cond: [{ $gte: ["$createdAt", monthStart] }, "$rewardStars", 0] } } } },
  ]), StarsLedgerEntry.aggregate([
    { $match: { accountUser: { $in: creatorRows.map((row) => row.invitee?._id).filter(Boolean) }, financialMode: { $ne: "TEST" }, direction: "CREDIT", entryType: { $in: ["WORLD_CREATOR_EARNING", "PREMIUM_CREATOR_EARNING", "DREAM_CREATOR_EARNING", "CHAT_GIFT_EARNING", "DA_CREATOR_EARNING", "CALL_CREATOR_EARNING"] }, createdAt: { $gte: monthStart } } },
    { $group: { _id: "$accountUser", stars: { $sum: "$starsAmount" } } },
  ])]) : [[], []];
  const byReferral = new Map(earnings.map((row) => [String(row._id), row]));
  const incomeByCreator = new Map(creatorIncome.map((row) => [String(row._id), Number(row.stars || 0)]));
  const invitedCreators = creatorRows.slice(0, 20).map((row) => {
    const earned = byReferral.get(String(row._id)) || {};
    const end = new Date(row.expiresAt);
    const monthsLeft = Math.max(0, Math.ceil((end - new Date()) / (30.4375 * 24 * 60 * 60 * 1000)));
    return { id: String(row._id), type: row.type, attributedAt: row.attributedAt, person: person(row.invitee), creatorMonthEarningsAmount: Number(incomeByCreator.get(String(row.invitee?._id)) || 0) / starsPerUsd, earningsAmount: Number(earned.total || 0) / starsPerUsd, monthEarningsAmount: Number(earned.month || 0) / starsPerUsd, monthsLeft };
  });
  const referralMonthStars = earnings.reduce((sum, row) => sum + Number(row.month || 0), 0);
  const total = rows.length;
  return {
    config: { ...REFERRAL_CONFIG, creatorReferral: { enabled: policy.enabled, months: policy.eligibleMonths, firstPayoutDays: policy.firstPayoutDays, minimumCreatorMonthlyUsd: policy.minimumCreatorMonthlyUsd } },
    codes,
    counts: { total, creators: creatorRows.length, friends: friendRows.length, spotlightRemaining: Math.max(0, REFERRAL_CONFIG.spotlightGoal - total) },
    earnings: policy.enabled ? { amount: referralMonthStars / starsPerUsd, stars: referralMonthStars } : null,
    creatorReferral: { enabled: policy.enabled, thisMonthAmount: policy.enabled ? referralMonthStars / starsPerUsd : 0, creators: policy.enabled ? invitedCreators : invitedCreators.map((row) => ({ ...row, earningsAmount: 0, monthEarningsAmount: 0 })) },
    recent,
    invitedCreators,
  };
}
