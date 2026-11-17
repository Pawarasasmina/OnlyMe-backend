import { Router } from "express";
import { acknowledgeMyWarning, listMyPendingWarnings } from "../controllers/moderationWarningController.js";
import { getCurrentUser, getMyWallHints, dismissMyWallHint, getMyWallView, updateMyWallView } from "../controllers/userController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = Router();

router.get("/me", protect, getCurrentUser);
router.get("/me/wall-view", protect, getMyWallView);
router.patch("/me/wall-view", protect, updateMyWallView);
router.get("/me/wall-hints", protect, getMyWallHints);
router.post("/me/wall-hints/:hintId", protect, dismissMyWallHint);
router.get("/me/moderation-warnings", protect, listMyPendingWarnings);
router.post("/me/moderation-warnings/:warningId/acknowledge", protect, acknowledgeMyWarning);

export default router;
