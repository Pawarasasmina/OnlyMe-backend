import CallSession from "../models/CallSession.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { env } from "../config/env.js";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { openPaidCall, paidCallOffer } from "../services/paidCallService.js";
import ApiError from "../utils/ApiError.js";

const person = (user) => user ? { id: String(user._id), displayName: user.name, username: user.username, avatarUrl: user.avatar || null } : null;
const serialize = (call, me) => ({ id: String(call._id), type: call.type, status: call.status, direction: String(call.caller?._id || call.caller) === String(me) ? "OUTGOING" : "INCOMING", caller: call.caller?.name ? person(call.caller) : { id: String(call.caller) }, recipient: call.recipient?.name ? person(call.recipient) : { id: String(call.recipient) }, paid: Boolean(call.paid), priceStars: call.priceStars || 0, durationLimitSeconds: call.durationLimitSeconds || 0, settlementStatus: call.settlementStatus || "FREE", answeredAt: call.answeredAt, connectedAt: call.connectedAt, endedAt: call.endedAt, durationSeconds: call.durationSeconds || 0, endReason: call.endReason || "", createdAt: call.createdAt });

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
  const result = await openPaidCall({ fan: req.user, creatorId: req.params.creatorId, key: req.body.idempotencyKey, type: req.body.type });
  return sendResponse(res, 201, "Paid call requested", result);
});
