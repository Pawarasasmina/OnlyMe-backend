import { Router } from "express";
import { acknowledgeMyWarning, listMyPendingWarnings } from "../controllers/moderationWarningController.js";
import { getCurrentUser } from "../controllers/userController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = Router();

router.get("/me", protect, getCurrentUser);
router.get("/me/moderation-warnings", protect, listMyPendingWarnings);
router.post("/me/moderation-warnings/:warningId/acknowledge", protect, acknowledgeMyWarning);

export default router;
