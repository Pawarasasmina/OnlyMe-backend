import Message from "../models/Message.js";

export async function deliverMessages(io, recipientId) {
  const messages = await Message.find({ recipient: recipientId, deliveredAt: null }).select("_id sender").sort({ _id: -1 }).limit(1000).lean();
  if (!messages.length) return;
  await Message.updateMany({ _id: { $in: messages.map(message => message._id) }, recipient: recipientId, deliveredAt: null }, { $set: { deliveredAt: new Date() } });
  for (const sender of new Set(messages.map(message => String(message.sender)))) io?.to(`user:${sender}`).emit("messages:delivered", { byUserId: String(recipientId) });
}
