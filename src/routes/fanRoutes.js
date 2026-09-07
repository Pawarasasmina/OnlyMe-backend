import { Router } from "express";
import {
  acknowledgeFanActivity,
  getFanActivity,
  getFanDashboard,
  getFanMessages,
  getFanPurchases,
  getFanSubscriptions,
  getFanWallet,
} from "../controllers/fanController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";

const router = Router();

router.use(protect, authorize("fan", "creator"));

router.get("/dashboard", getFanDashboard);
router.get("/subscriptions", getFanSubscriptions);
router.get("/wallet", getFanWallet);
router.get("/purchases", getFanPurchases);
router.get("/messages", getFanMessages);
router.get("/activity", getFanActivity);
router.post("/activity/:activityId/acknowledge", acknowledgeFanActivity);

export default router;
