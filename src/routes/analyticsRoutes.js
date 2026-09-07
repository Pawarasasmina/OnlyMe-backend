import { Router } from "express";
import { analyticsRateLimit, endSession, startSession, trackBatch, trackEvent } from "../controllers/analyticsController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = Router();

router.use(protect, analyticsRateLimit);
router.post("/sessions/start", startSession);
router.post("/sessions/end", endSession);
router.post("/events", trackEvent);
router.post("/events/batch", trackBatch);

export default router;
