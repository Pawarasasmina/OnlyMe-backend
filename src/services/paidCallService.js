import CallSession from "../models/CallSession.js";
import CreatorProfile from "../models/CreatorProfile.js";
import User from "../models/User.js";
import UserBlock from "../models/UserBlock.js";
import Wallet from "../models/Wallet.js";
import StarsLedgerEntry from "../models/StarsLedgerEntry.js";
import PlatformRevenue from "../models/PlatformRevenue.js";
import Notification from "../models/Notification.js";
import ApiError from "../utils/ApiError.js";
import { executeFinancialCommand } from "./financialCommandService.js";
import { creditWallet, debitWallet, safeWallet } from "./walletLedgerService.js";
import { fingerprint, idempotencyKey } from "../validators/financialValidator.js";

export const PAID_CALL_REQUEST_MS = 48 * 60 * 60 * 1000;
export const PAID_CALL_PLATFORM_RATE_BPS = 2000;

export function serializePaidCall(call) {
  if (!call) return null;
  return {
    id: String(call._id), callerId: String(call.caller?._id || call.caller), recipientId: String(call.recipient?._id || call.recipient),
    type: call.type, status: call.status, paid: Boolean(call.paid), priceStars: call.priceStars || 0,
    durationLimitSeconds: call.durationLimitSeconds || 0, settlementStatus: call.settlementStatus || "FREE",
    requestExpiresAt: call.requestExpiresAt, connectedAt: call.connectedAt, createdAt: call.createdAt,
  };
}

export async function paidCallOffer(fan, creatorId) {
  if (!["fan", "creator"].includes(fan.role)) throw new ApiError(403, "This account cannot request a paid creator call");
  const [creator, profile, wallet, blocked] = await Promise.all([
    User.findOne({ _id: creatorId, role: { $in: ["fan", "creator"] }, creatorApprovalStatus: "approved", status: "active" }).select("_id name username avatar role creatorApprovalStatus").lean(),
    CreatorProfile.findOne({ user: creatorId }).select("directCallEnabled directCallPriceStars directCallDurationMinutes directCallAutoDeclineAway").lean(),
    Wallet.findOne({ user: fan._id }).select("balance").lean(),
    UserBlock.exists({ $or: [{ blocker: fan._id, blocked: creatorId }, { blocker: creatorId, blocked: fan._id }] }),
  ]);
  if (!creator || !profile) throw new ApiError(404, "Creator not found");
  if (blocked) throw new ApiError(403, "Calling is unavailable for this account");
  return { enabled: Boolean(profile.directCallEnabled), priceStars: profile.directCallPriceStars || 500, durationMinutes: profile.directCallDurationMinutes || 5, autoDeclineWhenAway: Boolean(profile.directCallAutoDeclineAway), walletBalance: wallet?.balance ?? 0, creator };
}

export async function openPaidCall({ fan, creatorId, key, type = "AUDIO" }) {
  key = idempotencyKey(key);
  const offer = await paidCallOffer(fan, creatorId);
  if (!offer.enabled) throw new ApiError(403, "This creator is not accepting paid calls");
  const { creator, priceStars, durationMinutes } = offer;
  return executeFinancialCommand({
    user: fan._id, commandType: "OPEN_PAID_CALL", idempotencyKey: key,
    requestFingerprint: fingerprint({ creatorId: String(creator._id), priceStars, durationMinutes, type }),
  }, async (session, command) => {
    const existing = await CallSession.findOne({ status: { $in: ["REQUESTED", "RINGING", "ACTIVE"] }, $or: [{ caller: { $in: [fan._id, creator._id] } }, { recipient: { $in: [fan._id, creator._id] } }] }).session(session);
    if (existing) throw new ApiError(409, "One of you already has an active call request", "CALL_ALREADY_ACTIVE");
    const now = new Date();
    const [call] = await CallSession.create([{ caller: fan._id, recipient: creator._id, type: type === "VIDEO" ? "VIDEO" : "AUDIO", status: "REQUESTED", paid: true, priceStars, durationLimitSeconds: durationMinutes * 60, settlementStatus: "HELD", requestExpiresAt: new Date(now.getTime() + PAID_CALL_REQUEST_MS), openingCommand: command._id }], { session });
    const held = await debitWallet({ user: fan._id, amount: priceStars, entryType: "CALL_HOLD_DEBIT", entryRole: "FAN_CALL_HOLD", referenceType: "PAID_CALL", referenceId: call._id, creator: creator._id, counterpartyUser: creator._id, command, idempotencyKey: key, metadata: { settlementStatus: "HELD", durationMinutes, requestExpiresAt: call.requestExpiresAt } }, session);
    call.holdLedgerEntry = held.entry._id;
    await call.save({ session });
    await Notification.create([{ user: creator._id, type: "paid_call_requested", title: `${fan.name || "A fan"} requested a ${durationMinutes}-minute call`, dedupeKey: `paid-call:${call._id}` }], { session });
    return { resultReference: call._id, call: serializePaidCall(call), wallet: safeWallet(held.wallet) };
  });
}

export async function refundPaidCall(callId, reason = "NOT_DELIVERED", now = new Date()) {
  const candidate = await CallSession.findById(callId).lean();
  if (!candidate || !candidate.paid || candidate.settlementStatus !== "HELD") return candidate ? { call: serializePaidCall(candidate), changed: false } : null;
  const key = `paid-call-refund:${candidate._id}`;
  return executeFinancialCommand({ user: candidate.caller, commandType: "REFUND_PAID_CALL", idempotencyKey: key, requestFingerprint: fingerprint({ callId: String(candidate._id), priceStars: candidate.priceStars }) }, async (session, command) => {
    const call = await CallSession.findOne({ _id: callId, settlementStatus: "HELD" }).session(session);
    if (!call) return { resultReference: callId, call: serializePaidCall(await CallSession.findById(callId).session(session)), changed: false };
    const held = await StarsLedgerEntry.findById(call.holdLedgerEntry).session(session);
    const refunded = await creditWallet({ user: call.caller, amount: call.priceStars, entryType: "CALL_REFUND_CREDIT", entryRole: "FAN_CALL_REFUND", referenceType: "PAID_CALL", referenceId: call._id, creator: call.recipient, counterpartyUser: call.recipient, command, idempotencyKey: key, reversalOf: held?._id, metadata: { reason } }, session);
    call.settlementStatus = "REFUNDED"; call.refundCommand = command._id; call.refundLedgerEntry = refunded.entry._id;
    if (["REQUESTED", "RINGING", "ACTIVE"].includes(call.status)) call.status = "FAILED";
    call.endedAt = call.endedAt || now; call.endReason = call.endReason || reason;
    await call.save({ session });
    await Notification.create([{ user: call.caller, type: "paid_call_refunded", title: `Your ${call.priceStars} Stars were refunded`, dedupeKey: `paid-call-refund:${call._id}` }], { session });
    return { resultReference: call._id, call: serializePaidCall(call), wallet: safeWallet(refunded.wallet), changed: true };
  });
}

export async function capturePaidCall(callId, now = new Date()) {
  const candidate = await CallSession.findById(callId).lean();
  if (!candidate) throw new ApiError(404, "Call not found");
  if (!candidate.paid || candidate.settlementStatus === "CAPTURED") return { call: serializePaidCall(candidate), changed: false };
  if (candidate.settlementStatus !== "HELD") throw new ApiError(409, "This call is not capturable");
  const key = `paid-call-capture:${candidate._id}`;
  return executeFinancialCommand({ user: candidate.recipient, commandType: "CAPTURE_PAID_CALL", idempotencyKey: key, requestFingerprint: fingerprint({ callId: String(candidate._id), priceStars: candidate.priceStars }) }, async (session, command) => {
    const call = await CallSession.findOne({ _id: callId, settlementStatus: "HELD" }).session(session);
    if (!call) return { resultReference: callId, call: serializePaidCall(await CallSession.findById(callId).session(session)), changed: false };
    const platformStars = Math.floor((call.priceStars * PAID_CALL_PLATFORM_RATE_BPS) / 10000);
    const creatorStars = call.priceStars - platformStars;
    const earned = await creditWallet({ user: call.recipient, amount: creatorStars, entryType: "CALL_CREATOR_EARNING", entryRole: "CREATOR_CALL_EARNING", referenceType: "PAID_CALL", referenceId: call._id, creator: call.recipient, counterpartyUser: call.caller, command, idempotencyKey: key, metadata: { settlementStatus: "CAPTURED", grossStars: call.priceStars, creatorStars, platformStars, platformRateBasisPoints: PAID_CALL_PLATFORM_RATE_BPS } }, session);
    const [revenue] = await PlatformRevenue.create([{ sourceType: "PAID_CALL", referenceId: String(call._id), fan: call.caller, creator: call.recipient, grossStars: call.priceStars, creatorStars, platformStars, rateBasisPoints: PAID_CALL_PLATFORM_RATE_BPS, command: command._id, capturedAt: now }], { session });
    call.settlementStatus = "CAPTURED"; call.captureCommand = command._id; call.creatorEarningLedgerEntry = earned.entry._id; call.platformRevenue = revenue._id; call.connectedAt = call.connectedAt || now;
    await call.save({ session });
    await Notification.create([{ user: call.recipient, type: "paid_call_earned", title: `You earned ${creatorStars} Stars from a call`, dedupeKey: `paid-call-capture:${call._id}` }], { session });
    return { resultReference: call._id, call: serializePaidCall(call), wallet: safeWallet(earned.wallet), changed: true };
  });
}

export async function processDuePaidCalls(now = new Date(), io = null) {
  const due = await CallSession.find({ paid: true, settlementStatus: "HELD", requestExpiresAt: { $lte: now } }).select("_id").limit(200).lean();
  for (const item of due) {
    try { const result = await refundPaidCall(item._id, "REQUEST_EXPIRED", now); if (result?.call) io?.to(`user:${result.call.callerId}`).to(`user:${result.call.recipientId}`).emit("call:settlement", result.call); }
    catch { await CallSession.updateOne({ _id: item._id, settlementStatus: "HELD" }, { $set: { settlementStatus: "REFUND_PENDING" } }).catch(() => {}); }
  }
  return { refunded: due.length };
}
