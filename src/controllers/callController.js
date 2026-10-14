import CallSession from "../models/CallSession.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { env } from "../config/env.js";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { openPaidCall, paidCallOffer } from "../services/paidCallService.js";
import ApiError from "../utils/ApiError.js";
import Notification from "../models/Notification.js";

const person = (user) => user ? { id: String(user._id), displayName: user.name, username: user.username, avatarUrl: user.avatar || null } : null;
const serialize = (call, me) => ({ id: String(call._id), type: call.type, status: call.status, direction: String(call.caller?._id || call.caller) === String(me) ? "OUTGOING" : "INCOMING", caller: call.caller?.name ? person(call.caller) : { id: String(call.caller) }, recipient: call.recipient?.name ? person(call.recipient) : { id: String(call.recipient) }, paid: Boolean(call.paid), topic: call.topic || "", priority: Boolean(call.priority), priceStars: call.priceStars || 0, durationLimitSeconds: call.durationLimitSeconds || 0, settlementStatus: call.settlementStatus || "FREE", scheduledFor: call.scheduledFor, rescheduleRequestedAt: call.rescheduleRequestedAt, rescheduleRequestedBy: call.rescheduleRequestedBy ? String(call.rescheduleRequestedBy?._id || call.rescheduleRequestedBy) : null, answeredAt: call.answeredAt, connectedAt: call.connectedAt, endedAt: call.endedAt, durationSeconds: call.durationSeconds || 0, endReason: call.endReason || "", createdAt: call.createdAt });

export const callConfiguration = asyncHandler(async (req, res) => {
  const iceServers = [];
  if (env.stunUrls.length) iceServers.push({ urls: env.stunUrls });
  if (env.turnUrls.length && env.turnSecret) {
    const username = `${Math.floor(Date.now() / 1000) + 3600}:${req.user._id}`;
    const credential = crypto.createHmac("sha1", env.turnSecret).update(username).digest("base64");
    iceServers.push({ urls: env.turnUrls, username, credential });
  } else if (env.turnUrls.length && env.turnUsername && env.turnCredential) iceServers.push({ urls: env.turnUrls, username: env.turnUsername, credential: env.turnCredential });
  return sendResponse(res, 200, "Call configuration fetched", { iceServers, ringTimeoutSeconds: 30 });
});

export const callHistory = asyncHandler(async (req, res) => {
  const calls = await CallSession.find({ $or: [{ caller: req.user._id }, { recipient: req.user._id }] }).sort({ createdAt: -1 }).limit(100).populate("caller recipient", "name username avatar").lean();
  return sendResponse(res, 200, "Call history fetched", { calls: calls.map((call) => serialize(call, req.user._id)) });
});

export const getPaidCallOffer = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.creatorId)) throw new ApiError(400, "Invalid creator id");
  return sendResponse(res, 200, "Paid call offer fetched", await paidCallOffer(req.user, req.params.creatorId));
});

export const requestPaidCall = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.creatorId)) throw new ApiError(400, "Invalid creator id");
  const result = await openPaidCall({ fan: req.user, creatorId: req.params.creatorId, key: req.body.idempotencyKey, type: req.body.type, topic: req.body.topic, priority: req.body.priority });
  return sendResponse(res, 201, "Paid call requested", result);
});

export const schedulePaidCall = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.callId)) throw new ApiError(400, "Invalid call request");
  const scheduledFor = new Date(req.body.scheduledFor);
  const now = new Date();
  if (Number.isNaN(scheduledFor.getTime()) || scheduledFor <= now || scheduledFor > new Date(now.getTime() + 24 * 60 * 60 * 1000)) throw new ApiError(400, "Choose a time within the next 24 hours");
  const candidate = await CallSession.findOne({ _id: req.params.callId, paid: true, status: "REQUESTED", settlementStatus: "HELD", requestExpiresAt: { $gt: now }, $or: [{ recipient: req.user._id, scheduledFor: null, rescheduleRequestedBy: null }, { rescheduleRequestedBy: { $nin: [null, req.user._id] }, $or: [{ caller: req.user._id }, { recipient: req.user._id }] }] });
  const call = candidate ? await CallSession.findByIdAndUpdate(candidate._id, { $set: { scheduledFor, scheduledPromptSentAt: null, reminderSentAt: null, answeredAt: now, requestExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000) }, $unset: { rescheduleRequestedAt: 1, rescheduleRequestedBy: 1 } }, { new: true }).populate("caller recipient", "name username avatar") : null;
  if (!call) throw new ApiError(409, "This call request can no longer be scheduled");
  await Promise.all([
    Notification.updateOne({ dedupeKey: `paid-call-confirmed:${call._id}` }, { $setOnInsert: { user: call.caller._id, type: "paid_call_confirmed", title: `${call.recipient.name} confirmed your call`, message: scheduledFor.toISOString(), dedupeKey: `paid-call-confirmed:${call._id}` } }, { upsert: true }),
    Notification.updateOne({ dedupeKey: `paid-call-scheduled:${call._id}` }, { $setOnInsert: { user: call.recipient._id, type: "paid_call_confirmed", title: "Call scheduled", message: scheduledFor.toISOString(), dedupeKey: `paid-call-scheduled:${call._id}` } }, { upsert: true }),
  ]);
  req.app.get("io")?.to(`user:${call.caller._id}`).to(`user:${call.recipient._id}`).emit("call:scheduled", serialize(call, req.user._id));
  return sendResponse(res, 200, "Call scheduled", { call: serialize(call, req.user._id) });
});

export const requestCallReschedule = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.callId)) throw new ApiError(400, "Invalid call request");
  const now = new Date();
  const call = await CallSession.findOneAndUpdate({ _id: req.params.callId, paid: true, status: "REQUESTED", settlementStatus: "HELD", scheduledFor: { $ne: null }, $or: [{ caller: req.user._id }, { recipient: req.user._id }] }, { $set: { rescheduleRequestedAt: now, rescheduleRequestedBy: req.user._id, requestExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000) } }, { new: true }).populate("caller recipient", "name username avatar");
  if (!call) throw new ApiError(409, "This call cannot be rescheduled");
  const other = String(call.caller._id) === String(req.user._id) ? call.recipient : call.caller;
  await Notification.updateOne({ dedupeKey: `paid-call-reschedule:${call._id}:${now.getTime()}` }, { $setOnInsert: { user: other._id, type: "paid_call_reschedule", title: `${req.user.name} requested a new call time`, message: "Choose a replacement within 24 hours", dedupeKey: `paid-call-reschedule:${call._id}:${now.getTime()}` } }, { upsert: true });
  req.app.get("io")?.to(`user:${other._id}`).emit("call:reschedule-requested", serialize(call, other._id));
  return sendResponse(res, 200, "Reschedule requested", { call: serialize(call, req.user._id) });
});
