import { Router } from "express";
import rateLimit from "express-rate-limit";
import { acceptMessageRequest, blockMessageAccount, declineMessageRequest, deleteMessage, listConversations, listMessages, removeMessageReaction, reportConversation, reportMessage, searchMessagePeople, sendImageMessage, sendMessage, sendVideoNote, sendVoiceMessage, setMessageReaction, unblockMessageAccount } from "../controllers/messageController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";
import { uploadMessageImage, uploadVideoNote, uploadVoiceMessage } from "../middleware/uploadMiddleware.js";

const router = Router();
const messageSendLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "You are sending messages too quickly. Please wait a moment.", data: {} },
});

router.use(protect, authorize("fan", "creator"));
router.get("/conversations", listConversations);
router.get("/people", searchMessagePeople);
router.get("/conversations/:userId", listMessages);
router.post("/conversations/:userId", messageSendLimiter, sendMessage);
router.post("/conversations/:userId/voice", messageSendLimiter, uploadVoiceMessage.single("voice"), sendVoiceMessage);
router.post("/conversations/:userId/video-note", messageSendLimiter, uploadVideoNote.single("video"), sendVideoNote);
router.post("/conversations/:userId/image", messageSendLimiter, uploadMessageImage.single("image"), sendImageMessage);
router.post("/conversations/:userId/report", reportConversation);
router.put("/blocks/:userId", blockMessageAccount);
router.delete("/blocks/:userId", unblockMessageAccount);
router.put("/:messageId/reaction", setMessageReaction);
router.delete("/:messageId/reaction", removeMessageReaction);
router.delete("/:messageId", deleteMessage);
router.post("/:messageId/report", reportMessage);
router.post("/requests/:userId/accept", acceptMessageRequest);
router.delete("/requests/:userId", declineMessageRequest);
export default router;
