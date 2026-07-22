import { Router } from "express";
import rateLimit from "express-rate-limit";
import { acceptMessageRequest, declineMessageRequest, listConversations, listMessages, searchMessagePeople, sendMessage } from "../controllers/messageController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";

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
router.post("/requests/:userId/accept", acceptMessageRequest);
router.delete("/requests/:userId", declineMessageRequest);
export default router;
