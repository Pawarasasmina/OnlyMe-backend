import { Router } from "express";
import rateLimit from "express-rate-limit";
import { acceptMessageRequest, archiveConversation, blockMessageAccount, declineMessageRequest, deleteConversation, deleteMessage, forwardMessage, listChatGifts, listConversations, listMessages, listShareRecipients, muteConversation, removeMessageReaction, reportConversation, reportMessage, searchMessagePeople, sendChatGift, sendImageMessage, sendMessage, sendSharedContent, sendVideoNote, sendVoiceMessage, setMessageReaction, unblockMessageAccount } from "../controllers/messageController.js";
import { askDirectAccessQuestion, getDirectAccessOffer, listDirectAccessWindows, openWindow, replyToFreeFanFollowup, sendFreeFanFollowup, updateDirectAccessSettings } from "../controllers/directAccessController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";
import { financialMutationLimit } from "../middleware/financialRateLimit.js";
import { uploadMessageImage, uploadVideoNote, uploadVoiceMessage } from "../middleware/uploadMiddleware.js";
import { addGroupMember, archiveGroup, createGroup, deleteGroup, deleteGroupMessage, forwardGroupMessage, getGroupMessages, listGroups, markGroupMessageDelivered, muteGroup, pinGroupToProfile, removeGroupAvatar, removeGroupMember, removeGroupMessageReaction, reportGroupMessage, sendGroupImageMessage, sendGroupMessage, sendGroupVideoNote, sendGroupVoiceMessage, setGroupAdmin, setGroupMessageReaction, syncGroupMessageDeliveries, updateGroup, updateGroupAvatar } from "../controllers/groupMessageController.js";

const router = Router();
const messageSendLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "You are sending messages too quickly. Please wait a moment.", data: {} },
});

router.use(protect, authorize("fan", "creator", "admin"));
router.get("/direct-access/windows", listDirectAccessWindows);
router.put("/direct-access/settings", financialMutationLimit, updateDirectAccessSettings);
router.get("/direct-access/offers/:creatorId", getDirectAccessOffer);
router.post("/direct-access/windows/:creatorId", financialMutationLimit, openWindow);
router.post("/direct-access/ask/:fanId", messageSendLimiter, askDirectAccessQuestion);
router.post("/direct-access/follow-up/:creatorId", messageSendLimiter, sendFreeFanFollowup);
router.post("/direct-access/follow-up/:messageId/reply", financialMutationLimit, messageSendLimiter, replyToFreeFanFollowup);
router.get("/conversations", listConversations);
router.get("/gifts", listChatGifts);
router.get("/people", searchMessagePeople);
router.get("/share/recipients", listShareRecipients);
router.post("/share", messageSendLimiter, sendSharedContent);
router.get("/groups", listGroups);
router.put("/groups/receipts/delivered", syncGroupMessageDeliveries);
router.post("/groups", messageSendLimiter, createGroup);
router.get("/groups/:groupId", getGroupMessages);
router.post("/groups/:groupId", messageSendLimiter, sendGroupMessage);
router.post("/groups/:groupId/voice", messageSendLimiter, uploadVoiceMessage.single("voice"), sendGroupVoiceMessage);
router.post("/groups/:groupId/image", messageSendLimiter, uploadMessageImage.single("image"), sendGroupImageMessage);
router.post("/groups/:groupId/video-note", messageSendLimiter, uploadVideoNote.single("video"), sendGroupVideoNote);
router.patch("/groups/:groupId", updateGroup);
router.post("/groups/:groupId/avatar", uploadMessageImage.single("avatar"), updateGroupAvatar);
router.delete("/groups/:groupId/avatar", removeGroupAvatar);
router.put("/groups/:groupId/archive", archiveGroup);
router.put("/groups/:groupId/mute", muteGroup);
router.put("/groups/:groupId/profile-pin", pinGroupToProfile);
router.post("/groups/:groupId/members", addGroupMember);
router.delete("/groups/:groupId/members/:userId", removeGroupMember);
router.put("/groups/:groupId/admins/:userId", setGroupAdmin);
router.delete("/groups/:groupId", deleteGroup);
router.put("/groups/messages/:messageId/reaction", setGroupMessageReaction);
router.delete("/groups/messages/:messageId/reaction", removeGroupMessageReaction);
router.put("/groups/messages/:messageId/delivered", markGroupMessageDelivered);
router.delete("/groups/messages/:messageId", deleteGroupMessage);
router.post("/groups/messages/:messageId/report", reportGroupMessage);
router.post("/groups/messages/:messageId/forward", messageSendLimiter, forwardGroupMessage);
router.get("/conversations/:userId", listMessages);
router.post("/conversations/:userId", messageSendLimiter, sendMessage);
router.post("/conversations/:userId/gifts", financialMutationLimit, messageSendLimiter, sendChatGift);
router.post("/conversations/:userId/voice", messageSendLimiter, uploadVoiceMessage.single("voice"), sendVoiceMessage);
router.post("/conversations/:userId/video-note", messageSendLimiter, uploadVideoNote.single("video"), sendVideoNote);
router.post("/conversations/:userId/image", messageSendLimiter, uploadMessageImage.single("image"), sendImageMessage);
router.post("/conversations/:userId/report", reportConversation);
router.put("/conversations/:userId/archive", archiveConversation);
router.put("/conversations/:userId/mute", muteConversation);
router.delete("/conversations/:userId", deleteConversation);
router.put("/blocks/:userId", blockMessageAccount);
router.delete("/blocks/:userId", unblockMessageAccount);
router.put("/:messageId/reaction", setMessageReaction);
router.delete("/:messageId/reaction", removeMessageReaction);
router.delete("/:messageId", deleteMessage);
router.post("/:messageId/report", reportMessage);
router.post("/:messageId/forward", messageSendLimiter, forwardMessage);
router.post("/requests/:userId/accept", acceptMessageRequest);
router.delete("/requests/:userId", declineMessageRequest);
export default router;
