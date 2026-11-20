import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import ApiError from "../utils/ApiError.js";

export async function findConversationState(pair, { restoreLegacy = true } = {}) {
  let conversation = await Conversation.findOne(pair.participantKey ? { $or: [{ participantKey: pair.participantKey }, ...(pair.fan ? [{ fan: pair.fan, creator: pair.creator }] : [])] } : pair);
  if (!conversation && restoreLegacy) {
    // Gifts are delivered independently and must not grant text-message consent.
    const hasMessages = await Message.exists({ mediaType: { $ne: "gift" }, $or: [{ sender: pair.fan, recipient: pair.creator }, { sender: pair.creator, recipient: pair.fan }] });
    if (hasMessages) conversation = await Conversation.findOneAndUpdate({ participantKey: pair.participantKey }, { $setOnInsert: { ...pair, status: "ACTIVE", acceptedAt: new Date(), acceptedByCreator: false } }, { new: true, upsert: true });
  }
  return conversation;
}

export async function giftConversationState(pair) {
  // Sending a gift neither starts a request nor accepts/changes an existing one.
  const conversation = await findConversationState(pair, { restoreLegacy: false });
  if (conversation?.status === "DECLINED") throw new ApiError(403, "This message request was declined");
  return conversation;
}
