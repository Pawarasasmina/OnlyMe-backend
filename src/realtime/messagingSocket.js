import jwt from "jsonwebtoken";
import User from "../models/User.js";
import UserBlock from "../models/UserBlock.js";
import CallSession from "../models/CallSession.js";
import Conversation from "../models/Conversation.js";
import CreatorProfile from "../models/CreatorProfile.js";
import { capturePaidCall, refundPaidCall } from "../services/paidCallService.js";
import { env } from "../config/env.js";
import mongoose from "mongoose";

const userSockets = new Map();
const callTimers = new Map();
function scheduleRingTimeout(io, call, timeoutMs = 30000) {
  const callId = String(call._id); const callerId = String(call.caller); const recipientId = String(call.recipient);
  const timer = setTimeout(async () => {
    const missed = await CallSession.findOneAndUpdate({ _id: call._id, status: "RINGING" }, { $set: { status: "MISSED", endedAt: new Date(), endReason: "NO_ANSWER" } }, { new: true });
    if (missed?.paid && missed.settlementStatus === "HELD") await refundPaidCall(missed._id, "NO_ANSWER").catch(() => {});
    if (missed) {
      io.to(`user:${callerId}`).emit("call:ended", { callId, status: "MISSED", reason: "NO_ANSWER" });
      io.to(`user:${recipientId}`).emit("call:ended", { callId, status: "MISSED", reason: "NO_ANSWER" });
    }
    callTimers.delete(callId);
  }, timeoutMs);
  timer.unref?.(); callTimers.set(callId, timer);
}
const isOnline = (userId) => [...(userSockets.get(userId)?.values() || [])].some(Boolean);

async function broadcastPresence(io, userId, payload) {
  const blocks = await UserBlock.find({
    $or: [{ blocker: userId }, { blocked: userId }],
  }).select("blocker blocked").lean();
  const blockedIds = new Set(blocks.flatMap((item) => [String(item.blocker), String(item.blocked)]));
  for (const connectedUserId of userSockets.keys()) {
    if (connectedUserId !== String(userId) && !blockedIds.has(connectedUserId)) {
      io.to(`user:${connectedUserId}`).emit("presence:update", payload);
    }
  }
}

async function setSocketActivity(io, socket, active) {
  const userId = socket.user._id.toString();
  const sockets = userSockets.get(userId) || new Map();
  const wasOnline = [...sockets.values()].some(Boolean);
  sockets.set(socket.id, active);
  userSockets.set(userId, sockets);
  const online = isOnline(userId);
  if (online === wasOnline) return;
  if (online) {
    await broadcastPresence(io, userId, { userId, online: true, lastSeenAt: socket.user.lastSeenAt || null });
    return;
  }
  const lastSeenAt = new Date();
  await User.updateOne({ _id: userId }, { $set: { lastSeenAt } }).catch(() => {});
  await broadcastPresence(io, userId, { userId, online: false, lastSeenAt });
}

function trackSocketActivity(io, socket, active) {
  clearTimeout(socket.data.presenceExpiry);
  socket.data.presenceExpiry = undefined;
  setSocketActivity(io, socket, active);
  if (active) {
    socket.data.presenceExpiry = setTimeout(() => setSocketActivity(io, socket, false), 20000);
    socket.data.presenceExpiry.unref?.();
  }
}

export function configureMessagingSocket(io) {
  io.use(async (socket, next) => {
    try {
      const decoded = jwt.verify(socket.handshake.auth?.token, env.accessSecret);
      const user = await User.findOne({ _id: decoded.sub, status: "active", role: { $in: ["fan", "creator"] } });
      if (!user) return next(new Error("Unauthorized"));
      socket.user = user;
      return next();
    } catch { return next(new Error("Unauthorized")); }
  });

  io.on("connection", (socket) => {
    const userId = socket.user._id.toString();
    socket.join(`user:${userId}`);
    setSocketActivity(io, socket, false);
    socket.on("presence:active", (active) => trackSocketActivity(io, socket, active === true));
    socket.on("presence:heartbeat", () => trackSocketActivity(io, socket, true));
    socket.on("presence:query", async (ids = [], reply) => {
      const safeIds = [...new Set(ids.map(String))].slice(0, 100);
      const blocks = await UserBlock.find({
        $or: [
          { blocker: userId, blocked: { $in: safeIds } },
          { blocked: userId, blocker: { $in: safeIds } },
        ],
      }).select("blocker blocked").lean();
      const blockedIds = new Set(blocks.flatMap((item) => [String(item.blocker), String(item.blocked)]));
      const presence = safeIds.filter((id) => !blockedIds.has(id)).map((id) => ({ userId: id, online: isOnline(id) }));
      if (typeof reply === "function") reply(presence);
    });
    socket.on("call:start", async (input = {}, reply) => {
      try {
        if (input.callId) {
          if (!mongoose.isValidObjectId(input.callId)) throw new Error("Invalid paid call request");
          const paidCall = await CallSession.findOne({ _id: input.callId, caller: userId, paid: true, settlementStatus: "HELD", status: "REQUESTED", requestExpiresAt: { $gt: new Date() } });
          if (!paidCall) throw new Error("This paid call request is no longer available");
          const recipientSettings = await CreatorProfile.findOne({ user: paidCall.recipient }).select("directCallAutoDeclineAway").lean();
          if (recipientSettings?.directCallAutoDeclineAway && !isOnline(String(paidCall.recipient))) {
            paidCall.status = "DECLINED"; paidCall.endedAt = new Date(); paidCall.endReason = "CREATOR_AWAY"; await paidCall.save();
            await refundPaidCall(paidCall._id, "CREATOR_AWAY").catch(() => {});
            throw new Error("The creator is away. Your Stars were refunded");
          }
          const payload = { callId: String(paidCall._id), type: paidCall.type, requested: true, paid: true, priceStars: paidCall.priceStars, durationLimitSeconds: paidCall.durationLimitSeconds, caller: { id: userId, displayName: socket.user.name, username: socket.user.username, avatarUrl: socket.user.avatar || null }, createdAt: paidCall.createdAt };
          io.to(`user:${paidCall.recipient}`).emit("call:incoming", payload);
          if (typeof reply === "function") reply({ ok: true, call: payload });
          return;
        }
        const recipientId = String(input.recipientId || "");
        const type = input.type === "VIDEO" ? "VIDEO" : "AUDIO";
        if (!recipientId || recipientId === userId) throw new Error("Choose another person to call");
        const [recipient, blocked, busy, conversation] = await Promise.all([
          User.findOne({ _id: recipientId, status: "active", role: { $in: ["fan", "creator"] } }).select("name username avatar").lean(),
          UserBlock.exists({ $or: [{ blocker: userId, blocked: recipientId }, { blocker: recipientId, blocked: userId }] }),
          CallSession.exists({ status: { $in: ["RINGING", "ACTIVE"] }, $or: [{ caller: { $in: [userId, recipientId] } }, { recipient: { $in: [userId, recipientId] } }] }),
          Conversation.exists({ status: "ACTIVE", $or: [{ participants: { $all: [userId, recipientId] } }, { fan: userId, creator: recipientId }, { fan: recipientId, creator: userId }] }),
        ]);
        if (!recipient) throw new Error("Account unavailable");
        if (blocked) throw new Error("Calling is unavailable for this conversation");
        if (!conversation) throw new Error("Accept the message request before starting a call");
        if (busy) throw new Error("One of you is already on another call");
        if (socket.user.role === "fan") {
          const creatorCall = await CreatorProfile.findOne({ user: recipientId }).select("directCallEnabled").lean();
          if (creatorCall?.directCallEnabled) throw new Error("This creator accepts calls through paid Direct Access");
        }
        const call = await CallSession.create({ caller: userId, recipient: recipientId, type });
        const payload = { callId: String(call._id), type, caller: { id: userId, displayName: socket.user.name, username: socket.user.username, avatarUrl: socket.user.avatar || null }, createdAt: call.createdAt };
        io.to(`user:${recipientId}`).emit("call:incoming", payload);
        scheduleRingTimeout(io, call);
        if (typeof reply === "function") reply({ ok: true, call: payload });
      } catch (error) { if (typeof reply === "function") reply({ ok: false, message: error.message || "Could not start call" }); }
    });
    socket.on("call:accept", async ({ callId } = {}, reply) => {
      try {
        const now = new Date();
        const call = await CallSession.findOne({ _id: callId, recipient: userId, status: { $in: ["REQUESTED", "RINGING"] } });
        if (!call) throw new Error("This call is no longer available");
        const paidRequest = call.paid && call.status === "REQUESTED";
        call.status = paidRequest ? "RINGING" : "ACTIVE";
        call.answeredAt = now;
        await call.save();
        clearTimeout(callTimers.get(String(call._id))); callTimers.delete(String(call._id));
        io.to(`user:${call.caller}`).emit("call:accepted", { callId: String(call._id), acceptedAt: now, joinRequired: paidRequest });
        if (paidRequest) scheduleRingTimeout(io, call, 5 * 60 * 1000);
        if (typeof reply === "function") reply({ ok: true, acceptedAt: now, waitingForJoin: paidRequest });
      } catch (error) { if (typeof reply === "function") reply({ ok: false, message: error.message }); }
    });
    socket.on("call:join", async ({ callId } = {}, reply) => {
      try {
        if (!mongoose.isValidObjectId(callId)) throw new Error("Invalid call request");
        const call = await CallSession.findOneAndUpdate({ _id: callId, caller: userId, paid: true, settlementStatus: "HELD", status: "RINGING", answeredAt: { $ne: null } }, { $set: { status: "ACTIVE" } }, { new: true });
        if (!call) throw new Error("This accepted call is no longer available");
        clearTimeout(callTimers.get(String(call._id))); callTimers.delete(String(call._id));
        io.to(`user:${call.recipient}`).emit("call:join-ready", { callId: String(call._id) });
        if (typeof reply === "function") reply({ ok: true });
      } catch (error) { if (typeof reply === "function") reply({ ok: false, message: error.message }); }
    });
    socket.on("call:decline", async ({ callId } = {}) => {
      if (!mongoose.isValidObjectId(callId)) return;
      const now = new Date();
      const call = await CallSession.findOneAndUpdate({ _id: callId, recipient: userId, status: { $in: ["REQUESTED", "RINGING"] } }, { $set: { status: "DECLINED", endedAt: now, endedBy: userId, endReason: "DECLINED" } }, { new: true });
      if (!call) return;
      if (call.paid && call.settlementStatus === "HELD") await refundPaidCall(call._id, "DECLINED").catch(() => {});
      clearTimeout(callTimers.get(String(call._id))); callTimers.delete(String(call._id));
      io.to(`user:${call.caller}`).emit("call:ended", { callId: String(call._id), status: "DECLINED", reason: "DECLINED" });
    });
    socket.on("call:signal", async ({ callId, description, candidate } = {}) => {
      if (!mongoose.isValidObjectId(callId)) return;
      const call = await CallSession.findOne({ _id: callId, status: { $in: ["RINGING", "ACTIVE"] }, $or: [{ caller: userId }, { recipient: userId }] }).lean();
      if (!call) return;
      const otherId = String(call.caller) === userId ? String(call.recipient) : String(call.caller);
      io.to(`user:${otherId}`).emit("call:signal", { callId: String(call._id), fromUserId: userId, ...(description ? { description } : {}), ...(candidate ? { candidate } : {}) });
    });
    socket.on("call:connected", async ({ callId } = {}) => {
      if (!mongoose.isValidObjectId(callId)) return;
      const call = await CallSession.findOneAndUpdate({ _id: callId, status: "ACTIVE", $or: [{ caller: userId }, { recipient: userId }] }, { $addToSet: { connectedBy: userId } }, { new: true });
      if (!call || call.connectedBy.length < 2 || call.connectedAt) return;
      const now = new Date();
      const started = await CallSession.findOneAndUpdate({ _id: call._id, status: "ACTIVE", connectedAt: null }, { $set: { connectedAt: now } }, { new: true });
      if (!started) return;
      if (started.paid && started.settlementStatus === "HELD") {
        const result = await capturePaidCall(started._id, now).catch(async () => { await refundPaidCall(started._id, "CAPTURE_FAILED").catch(() => {}); return null; });
        if (!result) { io.to(`user:${started.caller}`).to(`user:${started.recipient}`).emit("call:ended", { callId: String(started._id), status: "FAILED", reason: "PAYMENT_FAILED" }); return; }
        io.to(`user:${started.caller}`).to(`user:${started.recipient}`).emit("call:settlement", result.call);
      }
      if (started.durationLimitSeconds > 0) {
        const timer = setTimeout(async () => {
          const endedAt = new Date();
          const ended = await CallSession.findOneAndUpdate({ _id: started._id, status: "ACTIVE" }, { $set: { status: "COMPLETED", endedAt, endReason: "TIME_LIMIT", durationSeconds: started.durationLimitSeconds } }, { new: true });
          if (ended) io.to(`user:${ended.caller}`).to(`user:${ended.recipient}`).emit("call:ended", { callId: String(ended._id), status: "COMPLETED", reason: "TIME_LIMIT", durationSeconds: ended.durationSeconds });
          callTimers.delete(String(started._id));
        }, started.durationLimitSeconds * 1000);
        timer.unref?.(); callTimers.set(String(started._id), timer);
      }
    });
    socket.on("call:end", async ({ callId, reason = "HANGUP" } = {}) => {
      if (!mongoose.isValidObjectId(callId)) return;
      const now = new Date();
      const call = await CallSession.findOne({ _id: callId, status: { $in: ["REQUESTED", "RINGING", "ACTIVE"] }, $or: [{ caller: userId }, { recipient: userId }] });
      if (!call) return;
      const wasActive = call.status === "ACTIVE";
      const wasConnected = wasActive && Boolean(call.connectedAt);
      call.status = wasConnected ? "COMPLETED" : "CANCELED";
      call.endedAt = now; call.endedBy = userId; call.endReason = String(reason).slice(0, 80);
      call.durationSeconds = wasConnected ? Math.max(0, Math.floor((now - call.connectedAt) / 1000)) : 0;
      await call.save();
      if (call.paid && call.settlementStatus === "HELD") await refundPaidCall(call._id, call.endReason || "NOT_CONNECTED").catch(() => {});
      clearTimeout(callTimers.get(String(call._id))); callTimers.delete(String(call._id));
      const otherId = String(call.caller) === userId ? String(call.recipient) : String(call.caller);
      io.to(`user:${otherId}`).emit("call:ended", { callId: String(call._id), status: call.status, reason: call.endReason, durationSeconds: call.durationSeconds });
    });
    socket.on("disconnect", async () => {
      clearTimeout(socket.data.presenceExpiry);
      const sockets = userSockets.get(userId);
      const wasOnline = isOnline(userId);
      sockets?.delete(socket.id);
      if (!sockets?.size) userSockets.delete(userId);
      if (!wasOnline || isOnline(userId)) return;
      const lastSeenAt = new Date();
      await User.updateOne({ _id: userId }, { $set: { lastSeenAt } }).catch(() => {});
      await broadcastPresence(io, userId, { userId, online: false, lastSeenAt });
    });
  });
}
