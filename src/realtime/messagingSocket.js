import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { env } from "../config/env.js";

const userSockets = new Map();
const isOnline = (userId) => [...(userSockets.get(userId)?.values() || [])].some(Boolean);

async function setSocketActivity(io, socket, active) {
  const userId = socket.user._id.toString();
  const sockets = userSockets.get(userId) || new Map();
  const wasOnline = [...sockets.values()].some(Boolean);
  sockets.set(socket.id, active);
  userSockets.set(userId, sockets);
  const online = isOnline(userId);
  if (online === wasOnline) return;
  if (online) {
    io.emit("presence:update", { userId, online: true, lastSeenAt: socket.user.lastSeenAt || null });
    return;
  }
  const lastSeenAt = new Date();
  await User.updateOne({ _id: userId }, { $set: { lastSeenAt } }).catch(() => {});
  io.emit("presence:update", { userId, online: false, lastSeenAt });
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
    socket.on("presence:query", (ids = [], reply) => {
      const presence = ids.slice(0, 100).map((id) => ({ userId: id, online: isOnline(id) }));
      if (typeof reply === "function") reply(presence);
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
      io.emit("presence:update", { userId, online: false, lastSeenAt });
    });
  });
}
