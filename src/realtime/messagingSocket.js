import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { env } from "../config/env.js";

const connections = new Map();
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
    const id = socket.user._id.toString();
    socket.join(`user:${id}`);
    connections.set(id, (connections.get(id) || 0) + 1);
    io.emit("presence:update", { userId: id, online: true, lastSeenAt: socket.user.lastSeenAt || null });
    socket.on("presence:query", (ids = [], reply) => {
      const presence = ids.slice(0, 100).map((userId) => ({ userId, online: connections.has(userId) }));
      if (typeof reply === "function") reply(presence);
    });
    socket.on("disconnect", async () => {
      const remaining = (connections.get(id) || 1) - 1;
      if (remaining > 0) return connections.set(id, remaining);
      connections.delete(id);
      const lastSeenAt = new Date();
      await User.updateOne({ _id: id }, { $set: { lastSeenAt } }).catch(() => {});
      io.emit("presence:update", { userId: id, online: false, lastSeenAt });
    });
  });
}
