import { Router } from "express";
import {
  getMyAccountSettings,
  getMyNotificationSettings,
  getMyPrivacySettings,
  updateMyAccountSettings,
  updateMyNotificationSettings,
  updateMyPrivacySettings,
} from "../controllers/profileController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = Router();

router.get("/privacy", protect, getMyPrivacySettings);
router.patch("/privacy", protect, updateMyPrivacySettings);
router.get("/notifications", protect, getMyNotificationSettings);
router.patch("/notifications", protect, updateMyNotificationSettings);
router.get("/account", protect, getMyAccountSettings);
router.patch("/account", protect, updateMyAccountSettings);

export default router;
