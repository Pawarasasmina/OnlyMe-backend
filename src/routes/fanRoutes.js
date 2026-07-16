import { Router } from "express";
import {
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

router.use(protect, authorize("fan"));

router.get("/dashboard", getFanDashboard);
router.get("/subscriptions", getFanSubscriptions);
router.get("/wallet", getFanWallet);
router.get("/purchases", getFanPurchases);
router.get("/messages", getFanMessages);
router.get("/activity", getFanActivity);

export default router;
