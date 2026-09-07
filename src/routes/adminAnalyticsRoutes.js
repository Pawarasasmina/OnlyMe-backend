import { Router } from "express";
import { exportAnalyticsReport, getAnalyticsReport } from "../controllers/adminAnalyticsController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";

const router = Router();

router.use(protect, authorize("admin"));
router.get("/", getAnalyticsReport);
router.get("/export", exportAnalyticsReport);

export default router;
